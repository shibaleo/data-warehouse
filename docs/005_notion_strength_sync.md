# Notion Strength 同期計画

筋トレ記録 (現状 Notion `TB__STRENGTH` データベース) を warehouse に取り込み、
data-drills の digest「運動」タブで Toggl (時間) と結合表示する。

## 1. 現状の Notion 列構成

| 列名 | 型 | 例 | 内部利用可? | 残す/差替 |
|---|---|---|---|---|
| `title` | Title | "2026-05-10 squat" | (date + subject) で auto 生成可 | **drop**: page id + date + subject で識別できれば redundant |
| `date` | Date | 2026-05-10 | `created_time::date` で 95% は代替可 | **残す (任意)**: 過去日付の遡及入力に備えて nullable |
| `subject` | Select | squat / chest-press / ... | — | **残す**: 種目マスタ化検討 (v2) |
| `weight` | Number | 30, 54, ... | — | **残す** (kg) |
| `number` | Number | 30, 40, ... | — | **曖昧**: 1 set あたり reps か total reps か明確化 (下記) |

### 内部利用するフィールド (Notion built-in)

| Notion 内部 | warehouse 採用 | 理由 |
|---|---|---|
| `id` (page UUID) | `source_id` | 安定 ID、append-only revision のキー |
| `created_time` | `recorded_at` / `date` の補完 | 入力日 ≒ 実施日と仮定。`date` 列が無い行のフォールバック |
| `last_edited_time` | `last_modified_at` | dedup + tombstone 判定 |
| `archived` | `deleted` フラグ | soft delete 反映 |
| `created_by` / `last_edited_by` | (skip) | single-user 想定なので不要 |

## 2. 列定義の再吟味 (v2 設計提案)

現状の列は最小限すぎる。筋トレログとして有用化するには:

### 必須化 / 明確化

- **`reps`** (現 `number` を rename + 意味明確化) = **1 セッションの総 reps**
  - 例: 3 セット × 10 reps なら 30
  - 別案: `sets_count` (= 3) + `reps_per_set` (= 10) に分割
  - **採用**: 「総 reps」シンプル方針。詳細は notes で
- **`sets_count`** (新規、optional) = 何セット行ったか
  - 無くても volume 推定可能 (= weight × reps)
- **`session_id`** (新規、optional) = 同日同種目の同一セッション識別
  - これがあれば 1 セッション複数行の表現可能 (= 高重量 1 set + 低重量 2 set のような複合)
  - v1 では skip、v2 で追加検討

### 推奨追加

- **`rpe`** (Rate of Perceived Exertion、1-10) — 主観強度
- **`notes`** — 自由記述 (フォーム崩れ / 痛み / 設定変更)
- **`body_weight`** — 体重比強度を出すため (Tanita と join しても可)
- **`equipment`** — barbell / dumbbell / machine 等 (subject の派生属性)

### Drop 候補

- **`title`** — `${date} ${subject}` で derive 可。手動入力させると typo 源
  - 移行戦略: title は parse しないで Notion 側で formula 化 (= 自動表示のみ、warehouse には sync しない)

### v1 で sync する最小カラム

決定:

```
source_id           uuid          (Notion page id)
notion_created_at   timestamptz   (Notion built-in)
notion_updated_at   timestamptz   (Notion built-in)
date                date          (Notion `date` プロパティ、欠損時は created_at::date)
subject             text          (Notion `subject` プロパティ)
weight_kg           numeric       (Notion `weight`)
reps                integer       (Notion `number` を rename)
deleted             boolean       (Notion archived 反映)
```

`title` は sync しない (= derive)。`sets_count` / `rpe` / `notes` は Notion 側で
プロパティ追加されたら staging で吸収できるよう **jsonb `extra` 列を 1 つ raw に
持っておく**ことを検討。

## 3. Warehouse schema

### 3.1 raw (append-only)

```sql
-- migrations/021_create_notion_strength_raw_tables.sql
CREATE TABLE data_warehouse_v2.raw_notion__strength (
  source_id        text NOT NULL,           -- Notion page id (UUID 文字列)
  revision         integer NOT NULL,
  data             jsonb NOT NULL,          -- Notion API レスポンスそのまま
  content_hash     text NOT NULL,           -- md5((data - 'last_edited_time')::text)
  deleted          boolean NOT NULL DEFAULT false,
  purged           boolean NOT NULL DEFAULT false,
  api_version      text NOT NULL,           -- 'v1'
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, revision)
);
-- append-only trigger (017_append_only_protection.sql と同パターン)
```

### 3.2 stg (型整形 + 現行 view)

```sql
-- apps/transform/models/staging/notion/stg_notion__strength.sql
WITH cur AS (
  SELECT * FROM raw_at('raw_notion__strength')
  WHERE deleted = false
)
SELECT
  source_id::uuid AS id,
  (data->>'created_time')::timestamptz   AS notion_created_at,
  (data->>'last_edited_time')::timestamptz AS notion_updated_at,
  COALESCE(
    (data->'properties'->'date'->'date'->>'start')::date,
    (data->>'created_time')::timestamptz::date
  ) AS date,
  (data->'properties'->'subject'->'select'->>'name') AS subject,
  (data->'properties'->'weight'->>'number')::numeric  AS weight_kg,
  (data->'properties'->'number'->>'number')::integer  AS reps,
  data AS raw_data
FROM cur
WHERE data->'properties'->'subject' IS NOT NULL
```

### 3.3 fct (presentation)

```sql
-- apps/transform/models/marts/health/fct_strength_session.sql
SELECT
  id,
  date,
  subject,
  weight_kg,
  reps,
  (weight_kg * reps)::numeric AS volume_kg_reps,
  notion_created_at,
  notion_updated_at
FROM {{ ref('stg_notion__strength') }}
ORDER BY date, subject
```

`volume_kg_reps` (= 「総挙上量」相当) を出しておくと sparkline / 集計が即出る。

## 4. Sync 戦略

### Notion API

- Endpoint: `POST https://api.notion.com/v1/databases/{database_id}/query`
- ヘッダ: `Authorization: Bearer {INTEGRATION_TOKEN}`, `Notion-Version: 2022-06-28`
- Pagination: `next_cursor` でカーソル
- Body: `{ "page_size": 100, "filter": { ... }, "sorts": [...] }`
- Rate limit: **3 req/sec** (sustained)

### 同期スケジュール

| 種別 | 頻度 | window | 用途 |
|---|---|---|---|
| `notionStrengthHourlySync` | 1h ごと | last 7 日 | 最近の入力反映 |
| `notionStrengthDailyFull` | 1d ごと | 全件 | rename / 削除 / 過去編集の反映 |

筋トレは 1 日数件しか追加されないので 1h sync で十分。daily full は edit/delete
を逃さないための保険。全件でも数百レコード規模なので 1 リクエスト数十件ペースで
完結する。

### 差分 / tombstone

- 内容ハッシュ: `md5((data - 'last_edited_time')::text)` で差分判定
- `last_edited_time` 自体は hash 対象から除外 (同期トリガで意味なく増えるため)
- `archived = true` → `deleted = true` で新 revision 追加 (tombstone)
- daily full で API レスポンスに含まれないが `_current` に存在する → 物理削除済とみなして tombstone

## 5. data-drills 側との接続

### 5.1 API route (data-drills)

```
GET /api/v1/exercise/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/v1/exercise/subjects                    # 種目一覧 (master 風)
GET /api/v1/exercise/summary?date=YYYY-MM-DD     # 当日 + 7d trend
```

Toggl の Exercise カテゴリ entry と date で left join すれば「いつ何分やって、
何 kg × 何 reps か」が 1 view になる。

### 5.2 digest 運動タブの構成案

| カード | 中身 |
|---|---|
| **Timeline** (共通) | Toggl Exercise category 帯のみ (sleep stage の代わりは無し) |
| **VOLUME** (= Stages 相当) | 当日の総挙上量、種目別 breakdown |
| **PR / TREND** (= Pace 相当) | 直近の最大重量 (= 1RM 推定) 推移、種目別 sparkline |
| **CONSISTENCY** (= Transition 相当) | 週あたりセッション数 + 種目バランス (push/pull/legs 比) |

Sleep の RECOVERY card に対応する身体指標 (体重、体脂肪率) は Tanita 由来で別途
出せるので、運動タブの 3 カード目候補にしてもいい。

## 6. 移行 (既存データ backfill)

Notion 側に 2026-03 以降の数十件しかない (= 5-10 件? UI で確認)。

```bash
# 1. integration を作って database を共有
# 2. .env に NOTION_TOKEN, NOTION_STRENGTH_DATABASE_ID 設定
# 3. 全件 sync を 1 回流す
node scripts/sync-notion-strength.mjs --full
```

過去日付の `date` プロパティが入っていれば warehouse 側は `created_time` ではなく
そちらを優先する (stg の COALESCE 順)。

## 7. 実装手順 (TODO)

1. [ ] Notion integration 作成 + token を `.env` に追加
2. [ ] migration: `021_create_notion_strength_raw_tables.sql`
3. [ ] connector: `apps/connector/src/notion/api-client.ts` + `sync-strength.ts`
4. [ ] entry point: `notionStrengthHourlySync` / `notionStrengthDailyFull` を `main.ts` に追加
5. [ ] dbt staging: `stg_notion__strength.sql`
6. [ ] dbt mart: `fct_strength_session.sql`
7. [ ] 1 回 backfill 実行 + verification
8. [ ] data-drills 側: `/api/v1/exercise/*` route + 運動タブ UI

## 8. v2 で検討する拡張

- `subject` を Notion 側で relation 化 (= Subject master DB を作って color/category 持つ)
- `sets_count` / `rpe` / `notes` プロパティ追加
- 体重連動の relative strength (kg/BW)
- Toggl との auto-link (= 同時刻帯 Exercise entry を session id で結合)
- PR (personal record) detection: 種目別最大重量を日次集計
