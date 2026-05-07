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
