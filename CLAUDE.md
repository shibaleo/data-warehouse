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

旧 `data_warehouse.raw_*` (UPSERT 時代) は凍結中。`raw_fitbit__*` は両スキーマで
完全 read-only に lock 済（migration 020、INSERT/UPDATE/DELETE/TRUNCATE 全ブロック）—
Fitbit ingestion は廃止し、データは raw_google_health__* に移行済み（2020-06〜）。
歴史的 archive として保持し、DROP しない。

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

## CRUD factory — tombstone / purge

raw / dim とも、テーブル作成後に対応する procedure を呼ぶと **per-table helper 関数群が自動生成**される。

```sql
-- raw 用
CREATE TABLE data_warehouse_v2.raw_<service>__<entity> ( ... );
CALL data_warehouse_v2.create_raw_functions('raw_<service>__<entity>');
-- → <tbl>_tombstone(source_id), <tbl>_purge(source_id) が生える

-- dim 用
CREATE TABLE data_warehouse_v2.<dim_name> ( ... );
CALL data_warehouse_v2.create_dim_functions('<dim_name>');
-- → <tbl>_at(biz_t, tx_t), <tbl>_tombstone(id, valid_from), <tbl>_purge(id) が生える
```

### tombstone

論理削除。`deleted=true` の新 revision を append（content は前 revision から carry-forward）。

```sql
SELECT data_warehouse_v2.raw_zaim__money_tombstone('abc123');                    -- raw
SELECT data_warehouse_v2.example_dim_tombstone('uuid...', '2026-06-01+09'::tz);  -- dim, valid_from 指定可
```

### purge

「無かったことにする」最終マーカー。`purged=true` の新 revision を append。CHECK で entity あたり 1 回限り。**物理削除は一切しない**（過去 revision はそのまま、padataload も維持）。GDPR 等で content 抹消が必要なら app 側で対応。

```sql
SELECT data_warehouse_v2.raw_zaim__money_purge('abc123');     -- raw
SELECT data_warehouse_v2.example_dim_purge('uuid...');        -- dim
```

## append-only 強制（opt-in）

table が "settled" になったら trigger を有効化、UPDATE / DELETE を DB レイヤーでブロック：

```sql
CALL data_warehouse_v2.enable_append_only_protection('raw_zaim__money');
```

外す必要が出たら明示的に `DROP TRIGGER` を migration として記録（migration history で意図を残すため）。

## Tests (pgtap)

invariant の自動検証は `migrations/tests/*.sql` を `psql -f` で実行。CI 用：

```bash
# 個別
psql -f migrations/tests/append_only_invariant.sql
psql -f migrations/tests/dim_at_retroactive.sql
psql -f migrations/tests/purge_uniqueness.sql

# pg_prove 経由で一括
pg_prove -h <host> -U <user> -d <db> migrations/tests/*.sql
```

dbt test は data quality（unique / not null）のみ。invariant 系は pgtap。

## Config

`public.dwh_config(key, value)` テーブル + `public.dwh_cfg(key)` 関数で集中管理。
schema 名 / hash algorithm 等のグローバル設定はここ参照。

```sql
SELECT public.dwh_cfg('schema_name');  -- → 'data_warehouse_v2'
```

新たな key を追加するなら：
```sql
INSERT INTO public.dwh_config (key, value) VALUES ('my_key', 'my_value');
```

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
