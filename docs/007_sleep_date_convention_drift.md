# sleep_date の convention が stg と fct で揺れている (start vs end)

## 症状

同じ Google Health sleep session が `stg_google_health__sleep` と `fct_health_sleep` で違う `sleep_date` を持っている。

| 表 | sleep_date セマンティクス | 例 (start 6/22 22:53 JST → end 6/23 05:46 JST) |
|---|---|---|
| `data_warehouse.stg_google_health__sleep` | **開始日 (start date)** | `sleep_date='2026-06-22'` |
| `data_presentation.fct_health_sleep` | **終了日 (end date)** | `sleep_date='2026-06-23'` |

実データで検証:

```sql
SELECT sleep_date, start_at AT TIME ZONE 'Asia/Tokyo' AS start_jst, end_at AT TIME ZONE 'Asia/Tokyo' AS end_jst
FROM data_presentation.fct_health_sleep
WHERE sleep_date BETWEEN '2026-06-22'::date AND '2026-06-24'::date AND sleep_type='STAGES'
ORDER BY start_at;

-- 結果:
-- 2026-06-22 | 2026-06-21 22:45:00 | 2026-06-22 07:35:00  ← end_date convention
-- 2026-06-23 | 2026-06-22 22:53:00 | 2026-06-23 05:46:00
-- 2026-06-24 | 2026-06-23 19:38:00 | 2026-06-24 06:32:00
```

```sql
SELECT sleep_date, sleep_type, start_time AT TIME ZONE 'Asia/Tokyo' AS start_jst, end_time AT TIME ZONE 'Asia/Tokyo' AS end_jst
FROM data_warehouse.stg_google_health__sleep
WHERE start_time >= '2026-06-21'::date AND start_time < '2026-06-25'::date
ORDER BY start_time;

-- 結果:
-- 2026-06-21 | STAGES  | 2026-06-21 22:45:00 | 2026-06-22 07:35:00  ← start_date convention
-- 2026-06-22 | CLASSIC | 2026-06-22 22:53:00 | 2026-06-23 05:46:00
-- 2026-06-23 | STAGES  | 2026-06-23 19:38:00 | 2026-06-24 06:32:00
```

## なぜ問題か

下流 (data-drills 等) で「ある日付の sleep」を取りに行く時、stg と fct で取れるレコードが 1 日ずれる。data-drills の digest は fct convention (end_date = 目覚めた日) を前提にしてるので、stg 直叩きルート (`/api/v1/sleep/stages`) で別の sleep を引いてしまい、timeline 表示が空になる症状が起きた。

## 期待する挙動

**fct 側の "終了日" convention に stg を寄せる** のが筋。理由:
- 一般的な日記/digest 文化では「ある日の sleep」= その日に目覚めた sleep
- fct 層が presentation 用なので、そっちが言語化されたユーザ向け定義として正しい
- stg を直叩きする consumer (drills) が convention 不一致でハマる

## 対策案

1. `stg_google_health__sleep` の `sleep_date` を `end_time::date AT TIME ZONE 'Asia/Tokyo'` ベースに直す (= fct と揃える)
2. もしくは stg を raw 由来のままにして、別カラム `wake_date` を追加 + ドキュメントで「sleep_date は raw 由来 start」と明示
3. fct 側に dbt logic としてしか定義しないなら、stg の sleep_date を deprecate

## drills 側の暫定対処 (参考)

`/api/v1/sleep/stages` の SQL は変えていない (stg の convention に依存)。CLASSIC 含めて取るよう変えたら (`sleep_type IN ('STAGES', 'CLASSIC')`)、結果的に `sleep_date BETWEEN from AND to` で「目覚めた日が from〜to にある sleep」も取れるようになった (start が前日深夜のものを含むため)。本質的には warehouse 側の修正が必要。

参考: data-drills の修正コミット (CLASSIC 包含で対症療法): TBD
