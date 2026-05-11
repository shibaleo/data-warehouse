# data-warehouse — Project rules for Claude

Concise rules for working in this repo. For background and roadmap see
`docs/000_design.md` and `docs/001_append_only_redesign.md`.

## 時間データの必須ルール — タイムゾーンを必ず付与

**raw 層に書き込む datetime 文字列は、必ず ISO 8601 の offset を含めること。**
"naive" な時刻文字列（offset 無し）を raw に保存するのは禁止。

理由：
- PostgreSQL の `::timestamptz` キャストは naive 文字列をサーバー TZ（実質 UTC）として解釈する
- これがズレを生み、LLM が raw を直接 SELECT すると毎回 9 時間ずれた解釈をしてしまう
- "raw は API レスポンスを忠実に保存" という principle より、"raw は曖昧さの無い時刻を保存" の方が下流の正しさに直結する

実装：
- API が naive 文字列を返したら、connector 側で offset を補完してから格納
  - 例: `"2026-05-05T23:32:00.000"` → `"2026-05-05T23:32:00.000+09:00"`
- API がすでに offset 付き（`Z` か `±hh:mm`）の場合は no-op
- 配列内ネストにも適用すること（例: Fitbit `levels.data[].dateTime`）
- `Asia/Tokyo` は DST が無いので fixed `+09:00` で OK。動的取得が必要なら API の profile / settings から

なぜ「raw 層で fix」かというと：
- stg 層で `AT TIME ZONE` する案 (Approach C) は LLM が raw を直接叩いた瞬間に破綻する
- 派生フィールド (`_*_utc`) を増やす案 (Approach D) は schema bloat
- offset 補完は「不完全な ISO 8601 を完全にする」だけで、瞬間的な事実は不変

詳細：`apps/connector/src/fitbit/sync.ts` の `withOffset()` ヘルパー。

## DB スキーマ — append-only / uni-temporal

すべての raw は `data_warehouse_v2.raw_*` (PRIMARY KEY: source_id + revision)。
書き込みは **必ず `appendRaw`** 経由。`upsertRaw` という関数は **存在しない**。

- 同 source_id でも content が変われば新 revision として INSERT
- content_hash は **DB 側で計算** (`md5((data - 'at')::text)`)。JS では計算しない
  - これにより backfill (PG md5) と runtime (PG md5) でハッシュが byte-identical
- 上流から消えた source_id は `deleted=true` の新 revision を append (UPDATE しない)
- 「現在有効な行」は `<table>_current` view 経由で取得

旧 `data_warehouse.raw_*` (UPSERT 時代) は凍結中、2026-05-15 以降に DROP 予定。

## 時点指定スナップショット — `raw_at(tbl, T)`

「T 時点で raw がどう見えていたか」を取りたいとき：
```sql
SELECT * FROM data_warehouse_v2.raw_at('raw_zaim__money', '2026-04-01 00:00+09'::timestamptz)
WHERE deleted = false AND purged = false;
```

- `T` 省略時は `now()`（=  `_current` view と同じ）
- 全 raw テーブルが同形なので 1 関数で対応（テーブル追加時にも変更不要）
- `<table>_current` view 群はこの関数を呼ぶ thin wrapper、**dbt models として管理** (`apps/transform/models/wrappers/`)。中身は共有マクロ `wrap_raw(source_name, table_name)` 経由

### 新 raw テーブル追加手順
1. raw 本体を `data_warehouse_v2.raw_<service>__<entity>` として作成（migration）
2. sources.yml に base table 名を 1 行追加
3. `models/wrappers/raw_<service>__<entity>_current.sql` を 1 行で作成：`{{ wrap_raw('raw_<service>', 'raw_<service>__<entity>') }}`
4. stg を書くなら `{{ ref('raw_<service>__<entity>_current') }}` で参照

`dbt run` 一発で wrapper が view として materialize される。

## Pattern 2 (bitemporal dim) — app-authored data

app-authored で **time-tracked** な dim を作るときは Pattern 2 を使う。
raw との違い:

| | Pattern 1 (raw) | Pattern 2 (dim) |
|---|---|---|
| id 型 | TEXT (外部 native) | uuid (`gen_random_uuid()`) |
| content | JSONB | typed columns |
| content_hash | あり | なし |
| valid_from | なし | あり、`DEFAULT now()` |
| as-of-T 軸 | tx_t のみ | biz_t + tx_t (per-table function) |

### 標準シェイプ

```sql
CREATE TABLE data_warehouse_v2.<dim_name> (
    id           uuid        NOT NULL DEFAULT gen_random_uuid(),
    revision     int         NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    valid_from   timestamptz NOT NULL DEFAULT now(),
    -- <typed content fields>
    deleted      boolean     NOT NULL DEFAULT false,
    purged       boolean     NOT NULL DEFAULT false,
    PRIMARY KEY (id, revision)
);
CREATE UNIQUE INDEX <name>_purge_unique ON ... (id) WHERE purged = true;
CREATE INDEX <name>_id_validfrom_revision_desc ON ... (id, valid_from DESC, revision DESC);
```

`valid_to` は物理列にしない（append-only を破るため）。range projection が必要なら `LEAD(valid_from) OVER (PARTITION BY id ORDER BY valid_from)` で derive。

### 新 dim テーブル追加手順

1. migration: `CREATE TABLE` (上記 shape)
2. migration の同 SQL 内で: `CALL data_warehouse_v2.create_dim_at_function('<dim_name>');`
   - これで `<dim_name>_at(biz_t, tx_t)` 関数が自動生成
3. `models/wrappers/<dim_name>_current.sql` を 1 行: `{{ wrap_dim('<dim_name>') }}`
4. `dbt run`

### retroactive / future-dated の使い分け

- 通常の更新（「今からこう」）→ `valid_from` 省略、`DEFAULT now()` が効く
- retroactive 訂正（「実は過去 X 日からこうだった」）→ `valid_from = '過去日付'` を明示
- future-dated 予約（「来月からこう」）→ `valid_from = '未来日付'` を明示

### 時点指定クエリ

```sql
-- 現在
SELECT * FROM data_warehouse_v2.<dim>_at();

-- biz_t 時点（過去の真実 = 現在の知識で過去をどう見るか）
SELECT * FROM data_warehouse_v2.<dim>_at('2026-03-01'::timestamptz);

-- tx_t 時点（その日 DB に書かれていた状態）
SELECT * FROM data_warehouse_v2.<dim>_at(now(), '2026-03-01'::timestamptz);

-- 両方指定（「2026-03-01 時点で、2026-02-15 の状態をどう知っていたか」）
SELECT * FROM data_warehouse_v2.<dim>_at('2026-02-15'::timestamptz, '2026-03-01'::timestamptz);
```

ORDER BY は `id, valid_from DESC, revision DESC` で固定（retroactive 正しさのため）。helper が自動セット。

実装サンプルと検証クエリは `migrations/013_pattern2_bitemporal.sql` を参照。

## dbt sources

stg は **必ず `_current` view** を参照する。ベーステーブル（全 revision）を直接読まない。
schema は `data_warehouse_v2`。

stg では：
- `synced_at` は v2 の `created_at` 列を `created_at as synced_at` で alias
- 旧 raw に存在した `id` (UUID) 列は v2 に無いので参照しない

## Deploy

GAS への反映は **`clasp push`** が必要（git push だけでは GAS に届かない）。

```bash
cd apps/connector && pnpm push          # = clasp push
```

`.clasp.json` は gitignored、ローカルで `pnpm exec clasp clone <SCRIPT_ID>` で再生成可能。

## ローカル DB 実行

`.env` の DATABASE_URL で接続。Bash 環境変数 export は：
```bash
set -a && . ./.env && set +a            # source .env だけだと dbt が NEON_HOST 見えない
```

## Toggl の rate limit

30 req/h。`scripts/resync-toggl-report.mjs` での全期間 resync は ~18 req で済む。
