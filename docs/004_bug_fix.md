# 睡眠データパイプライン バグ修正提案書

- 作成日: 2026-06-17
- 対象: `neon_warehouse`（`data_warehouse` / `data_warehouse_v2` / `data_presentation`）の睡眠系統
- 発端: 睡眠負債の検証中に `data_presentation.fct_health_sleep` が古い・かつ素朴に作り直すと数値破綻することが判明

## 概要

睡眠データ分析の過程で、独立した2つのバグを検出した。いずれも presentation 層 `fct_health_sleep` を誤らせる。

1. **配線バグ** — `fct_health_sleep` が非アクティブな **Fitbit** ブランチに配線されており、正データである **Google Health**（2026-06-16 まで同期済み）を拾えていない。
2. **二重計上バグ** — Google Health 生テーブルがバックフィルで同一 stage を複数バッチに重複保持しており、`created_at` 単位で素朴に集計すると stage を二重計上して、50h / 23h / 15h といった存在しない夜を生成する。

修正順序は **バグ2 → バグ1**。先にソースを健全化してから配線を張り替え、`fct` が破損ソースに繋がる瞬間を作らない。

---

## バグ1: presentation 層が非アクティブな Fitbit ソースに配線されている

### 症状
`fct_health_sleep` の最新 `sleep_date` が 2026-06-14 で停止。Google Health 側には存在する 6/15・6/16 の夜（および今朝 6/17 起床分）を欠落。

### 証拠

| テーブル | 最新日付 | 最終ロード |
|---|---|---|
| `data_warehouse.stg_fitbit__sleep` | 2026-06-14 | 2026-06-14T03:05:58Z |
| `data_warehouse.stg_google_health__sleep` | 2026-06-16 | 2026-06-16T23:00:54Z |
| `data_presentation.fct_health_sleep` | 2026-06-14 | 2026-06-14T03:05:58Z |

`fct` の最新日付・`synced_at` が Fitbit staging と完全一致しており、`fct` が `stg_fitbit__sleep` から作られていることを示す。Fitbit ingestion は停止/廃止状態、正データは Google Health に移行済み。

### 根本原因
`fct_health_sleep` のソースが停止済み Fitbit ブランチに固定されている。

### 影響
`fct_health_sleep` を参照する全下流（認知レディネスモデル Phase 1 等）が無言で 2〜3 日陳腐化する。

### 修正方針
バグ2 で健全化した Google Health セッションモデルへ `fct_health_sleep` のソースを張り替える。**スキーマは現状維持**（`sleep_date`, `minutes_asleep`, … を保つ）し、下流を非破壊にする。Fitbit ブランチは廃止または「deprecated」明示。

---

## バグ2: Google Health 生データのバックフィル重複による二重計上

### 症状
`data_warehouse_v2.raw_google_health__sleep_current` を `created_at`（取り込みバッチ）単位で集計すると、覚醒日 6/2 = **50.95h**、6/6 = **23.34h**、6/11 = **15.33h** といった物理的にあり得ない夜が出る。

### 根本原因
1. 同一の sleep-stage セグメントが複数の生レコード（バックフィルのバッチ）に**重複して**現れる。
2. 1 つの生レコードの `stages` 配列が**複数夜にまたがる**ことがある。
3. `created_at` は「取り込みバッチ」であって「睡眠セッション」ではない → 集計粒度が誤り。

正しい粒度は **睡眠セッション**で、これは stage タイムスタンプから再構成する。

### 修正方針（staging 変換ロジック）
1. `data->'sleep'->'stages'` を unnest。
2. `(type, startTime, endTime)` で **重複除去** → バックフィル重複を排除。
3. `startTime` 昇順に並べ、直前 stage の終了からの gap が **2 時間超**ならセッションを切る。
4. セッション単位で `asleep = Σ(非 AWAKE stage 長)`、`wake_date = セッション終了の JST 日付`。
5. `wake_date` で集計（夜中に分断されたセッションを再結合し、昼寝はその日付に独立計上）。

### 参照実装（検証済み SQL）

```sql
WITH all_stages AS (
  SELECT DISTINCT
    (st->>'type') AS stype,
    (st->>'startTime')::timestamptz AS s0,
    (st->>'endTime')::timestamptz   AS s1
  FROM data_warehouse_v2.raw_google_health__sleep_current,
       jsonb_array_elements(data->'sleep'->'stages') st
  WHERE data->'sleep' ? 'stages'
),
ordered AS (
  SELECT stype, s0, s1, LAG(s1) OVER (ORDER BY s0) AS prev_end FROM all_stages
),
sessioned AS (
  SELECT stype, s0, s1,
    SUM(CASE WHEN prev_end IS NULL OR s0 - prev_end > INTERVAL '2 hours'
             THEN 1 ELSE 0 END) OVER (ORDER BY s0) AS sid
  FROM ordered
),
sess AS (
  SELECT sid,
    (max(s1) AT TIME ZONE 'Asia/Tokyo')::date AS wake_date,
    min(s0) AS start_at, max(s1) AS end_at,
    SUM(EXTRACT(epoch FROM (s1-s0))) FILTER (WHERE stype <> 'AWAKE')/60.0 AS asleep_min,
    SUM(EXTRACT(epoch FROM (s1-s0)))/60.0 AS staged_min,
    SUM(EXTRACT(epoch FROM (s1-s0))) FILTER (WHERE stype = 'DEEP')/60.0  AS deep_min,
    SUM(EXTRACT(epoch FROM (s1-s0))) FILTER (WHERE stype = 'LIGHT')/60.0 AS light_min,
    SUM(EXTRACT(epoch FROM (s1-s0))) FILTER (WHERE stype = 'REM')/60.0   AS rem_min,
    SUM(EXTRACT(epoch FROM (s1-s0))) FILTER (WHERE stype = 'AWAKE')/60.0 AS wake_min
  FROM sessioned GROUP BY sid
)
SELECT wake_date,
  round(SUM(asleep_min))::int AS minutes_asleep,
  round(SUM(staged_min))::int AS time_in_bed,
  count(*) AS sessions
FROM sess
GROUP BY wake_date ORDER BY wake_date;
```

### 検証
クリーン化後の系列が、重複範囲（〜6/14）で Fitbit `fct` とほぼ一致し、再構成の妥当性を確認済み。

| 覚醒日 | 再構成(h) | Fitbit fct(h) |
|---|---|---|
| 6/2  | 5.63 | 5.57 |
| 6/8  | 1.35 | 1.30 |
| 6/9  | 5.83 | 5.75 |
| 6/14 | 5.83 | 5.68 |

修正前に出ていた 50.95h / 23.34h / 15.33h は、修正後それぞれ 5.63h / 7.65h / 5.80h に正常化。

---

## 提案する変更

1. **新規/改修 staging モデル** `stg_google_health__sleep_sessions`
   - 上記ロジックでセッション粒度の asleep/in-bed/stage 内訳を生成。
   - 重複除去はインクリメンタルロードでも冪等に保つ。
2. **`fct_health_sleep` のソース張り替え**（スキーマ非変更）

   | fct カラム | 新ソース（Google Health セッション） |
   |---|---|
   | `sleep_date` | `wake_date`（セッション終了の JST 日付） |
   | `minutes_asleep` | Σ 非 AWAKE stage 分 |
   | `time_in_bed` | セッション span（min start〜max end）分 |
   | `minutes_awake` | Σ AWAKE 分 |
   | `deep/light/rem/wake_minutes` | 各 type 合計 |
   | `start_at` / `end_at` | min(start) / max(end) |
   | `efficiency` | `minutes_asleep / time_in_bed * 100` |
   | `sleep_type` | `'STAGES'`（または main/nap 判定） |
   | `source_id` | セッション決定的キー（start のハッシュ等） |
   | `synced_at` | 寄与生レコードの max(`created_at`) |

---

## 検証計画

- **整合性**: 6/14 以前で Fitbit `fct` と突合、ソース丸め誤差（〜5%）内で一致を確認。
- **境界チェック**: 16h を超える夜は警告。`Σ(stage) > wall-clock` のセッションは重複検出として弾く。
- **欠落確認**: 6/15・6/16・6/17 が存在し妥当値であること。

## ロールアウトと留意点

- **順序**: バグ2（ソース健全化）→ バグ1（張り替え）。逆順だと破損ソースに `fct` が一時的に繋がる。
- **日付規約**: Google Health は **入眠日**、`fct` は **覚醒日（JST）** ラベル。約1日ずれるため `wake_date` ラベリング必須（検証済み: Google 6/11 入眠 ＝ fct 6/12 覚醒の夜）。下流の `sleep_date` join は要確認。
- **昼寝の扱い**: 現ロジックは昼寝をその覚醒日に独立計上。main sleep のみが必要なら、セッション長／時間帯でフィルタする方針を別途決める。

## スコープ外

- HRV・skin temperature・breathing rate・cardio score の stale pipeline（別案件、既知）。
- 認知レディネスモデル本体の変更。

## 付録: 検出時の証拠サマリ

- Fitbit staging 停止: 2026-06-14。Google Health staging: 2026-06-16 まで。
- `created_at` 集計の幻夜: 6/2=50.95h, 6/6=23.34h, 6/11=15.33h。
- 重複の機序: 同一 `(type,start,end)` stage が複数バックフィルバッチに出現 → DISTINCT で解消。