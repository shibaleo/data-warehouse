# data-warehouse 設計概要

## 役割

外部 API から取得した事実と手入力データを格納する層。**値の実体はここにある。**
DCMP（data-composition）の data_source として機能する。

> DWH = 事実（現実に縛られる）。解釈・意味付けは DCMP が担う。

---

## スキーマ構成

```
schema: data_warehouse    ← DWH 内部実装（触らない）
schema: data_presentation ← 外部公開インターフェース（DCMP・App が参照）
```

**外部システム（DCMP、App）は `data_presentation.*` のみ参照する。**
`data_warehouse.*` は DWH 内部実装であり、直接参照してはならない。

---

## レイヤー構成

```
raw_*   BASE TABLE  外部 API の生データ。connector のみが書き込む。触らない。
stg_*   VIEW        raw の薄い変換層（JSON展開・型キャスト）。DWH 内部。
dim_*   BASE TABLE  参照・分類テーブル。seed データまたは手動管理。DWH 内部。
─────────────────── schema 境界 ───────────────────
fct_*   BASE TABLE  外部公開ファクトテーブル。FK 解決・非正規化済み。
rpt_*   VIEW        可視化・集計専用。DCMP は参照しない。
```

---

## レイヤーの責務

### raw_*（data_warehouse schema）

- connector（GAS）が API から取得したデータをそのまま格納
- 全テーブル共通構造：`id UUID`, `source_id TEXT UNIQUE`, `data JSONB`, `synced_at TIMESTAMPTZ`
- `source_id` = 外部 API のネイティブ ID（冪等 INSERT のキー）
- **変更禁止。connector 以外は書き込まない。**

### stg_*（data_warehouse schema）

- raw の JSONB を展開し、型キャストした VIEW
- `id`（UUID）と `source_id` をそのまま継承
- FK（project_id、tag_ids 等）は未解決のまま
- DWH 内部の中間層。外部から直接参照しない。

### dim_*（data_warehouse schema）

- 分類・参照テーブル（カテゴリ、タグマッピング等）
- seed ファイルまたは手動管理
- stg / fct の JOIN 素材。外部から直接参照しない。
- **ソース固有の分類ルール**を保持する。概念統合は行わない。
  - 例: `dim_category_time_personal`（Toggl の color/project → personal_category）
  - これらの分類結果は App 層が `observation.attrs` に転記することで DCMP に渡る。

### fct_*（data_presentation schema）

- **DCMP・App への公開 API**
- stg + dim を JOIN して非正規化した BASE TABLE（マテリアライズ済み）
- 各行は raw の `id`（UUID）を継承。安定した `dwh_row_id` として機能する。
- **責務: FK 解決のみ。** 以下は行わない：
  - cross-source UNION（概念統合は DCMP の resource 階層が担う）
  - dedup・補正・合成行生成（これらは解釈であり DCMP / App の責務）
  - source-agnostic な統合（`fct_time_entries` のような横断モデルは作らない）
- **ソース固有**。`fct_toggl_time_entries` と `fct_clockify_time_entries` が並立するのは正しい。

### rpt_*（data_presentation schema）

- 可視化・集計専用の VIEW
- 補正・合成行・集計ロジックを含んでよい
- DCMP は参照しない。App / BI ツールが読む。
- 例: `rpt_time_records_continuous`（ギャップ補正済み 24h 連続タイムライン）

---

## DCMP に登録する fct テーブル

| fct テーブル | dwh_row_id カラム | 備考 |
|-------------|-----------------|------|
| `fct_zaim_transactions` | `id` (UUID) | Zaim 支出・収入・振替 |
| `fct_health_body` | `id` (UUID) | Tanita 体組成（1日1行） |
| `fct_health_sleep` | `id` (UUID) | Fitbit 睡眠（main sleep のみ） |
| `fct_toggl_time_entries` | `id` (UUID) | Toggl 時間記録（新設予定） |
| `stg_fitbit__activity` | `id` (UUID) | 日次活動量（fct 未作成） |

> `fct_health_body` の dedup（1日1行）は DWH 側の便宜的整理。
> DCMP での解釈（どの計測が「その日の値」か）は App / query 層が担う。

---

## 設計原則

- **raw は不変** — connector 以外は書き込まない
- **stg は内部** — 外部システムから参照しない
- **fct は public API** — DCMP は常に fct を通じて DWH を参照する
- **fct は非正規化のみ** — FK 解決（project_id → project_name 等）だけを行う
- **fct はソース固有** — cross-source 統合は DCMP の resource 階層が担う
- **dim はソース固有の分類ルール** — Toggl の color マッピング等。概念統合しない
- **rpt は可視化専用** — 補正・合成ロジックはここに閉じ込める

---

## DWH が担わないこと（DCMP の責務）

| 概念 | 理由 |
|------|------|
| 「Toggl エントリ = 時間リソース」という解釈 | resource 階層（DCMP）が担う |
| Toggl と Clockify の統合 | 同一 resource への observation 収束で表現 |
| 「どの計測がその日の代表値か」 | event / query 層が担う |
| カテゴリ分類の意味付け | observation.attrs + resource で表現 |

---

## データソース一覧

| ソース | raw テーブル | connector | sync |
|--------|------------|-----------|------|
| Toggl Track | `raw_toggl_track__*` | GAS | daily |
| Fitbit | `raw_fitbit__*` | GAS | daily |
| Tanita Health Planet | `raw_tanita_health_planet__*` | GAS | manual |
| Zaim | `raw_zaim__*` | GAS | daily |
| Overland | `raw_overland__locations` | - | - |
