# Google Health API 移行計画

Fitbit Web API は **2026年9月** に shutdown。後継の Google Health API へ移行する。
本ドキュメントは別セッションで実装を続けるための計画書。

## 確定事項（このセッションで完了済み）

### GCP / OAuth セットアップ
- GCP project 作成、Google Health API enable 済
- OAuth consent screen を **"In production"** に publish 済（restricted scope、100ユーザー以下なので self-cert で審査不要）
- OAuth Client (Web application) 作成、redirect URI = `https://www.google.com`
- `.env` に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 設定済
- 初回 authorization code flow 実施済、`data_warehouse.credentials` に `service_name='google_health'` 行を挿入済
- refresh_token は無期限（production publish 済のため）

### 4 scopes 承認済
- `googlehealth.sleep.readonly`
- `googlehealth.activity_and_fitness.readonly`
- `googlehealth.health_metrics_and_measurements.readonly`
- `googlehealth.location.readonly`

### 動作確認スクリプト
- `scripts/auth-google-health.mjs` — `url` / `exchange <code>` サブコマンド
- `scripts/probe-google-health.mjs` — 11 dataType を probe してレスポンスを `scripts/probe-out/*.json` に保存

### API 仕様の確認結果
- Base URL: `https://health.googleapis.com/v4/`
- Endpoint: `GET /users/me/dataTypes/{kebab-case-type}/dataPoints?pageSize=&filter=&pageToken=`
- Filter syntax: `{snake_case_type}.{field} >= "..." AND ... < "..."`
- Pagination: `nextPageToken` でカーソル
- レスポンス時刻: `physicalTime` (UTC `Z` 付き) + `utcOffset: "32400s"` (Google Duration) の分離型
  - **CLAUDE.md の TZ ルール（offset 必須）を `Z` で満たしている → `withOffset()` ヘルパー不要**
- `users/me` 有効
- `name` field の最終セグメントが安定 source_id（ただし一部 dataType は空 → synthetic ID 必要）

## マッピング表（Fitbit → Google Health）

| 旧 Fitbit raw | 新 Google Health dataType | filter フィールド | source_id 戦略 |
|---|---|---|---|
| raw_fitbit__sleep | sleep | `sleep.interval.end_time` | name 末尾セグメント |
| raw_fitbit__activity | **3分割**: steps / active-minutes / distance | `*.interval.start_time` | name 末尾セグメント |
|  | exercise | `exercise.interval.end_time` | name 末尾セグメント |
| raw_fitbit__heart_rate | daily-resting-heart-rate | `daily_resting_heart_rate.civil_date` | civil_date 文字列 |
| raw_fitbit__hrv | daily-heart-rate-variability | `*.civil_date` | civil_date 文字列 |
| raw_fitbit__spo2 | daily-oxygen-saturation | `*.civil_date` | civil_date 文字列 |
| raw_fitbit__breathing_rate | respiratory-rate-sleep-summary | filter で 400、要追試（`sample_time.physical_time` 系）or 無 filter + ページング | `sampleTime.physicalTime` 文字列（name が空） |
| raw_fitbit__cardio_score | daily-vo2-max | `*.civil_date` | civil_date 文字列 |
| raw_fitbit__temperature_skin | daily-sleep-temperature-derivations | `*.civil_date` | civil_date 文字列 |

→ raw テーブル数は **8 → 10**（activity 分割で +2、breathing は1つ、cardio_score は daily-vo2-max にリネーム相当）

## 設計判断（仮決定、別セッションで再確認）

### 判断1: 旧 fitbit raw との関係
**仮決定: 旧 `raw_fitbit__*` は凍結、新規 prefix `raw_google_health__*` で新設**

- CLAUDE.md の「新 raw テーブル追加手順」に従う
- 移行期間（〜2026-09）は両走、9月直前に GAS trigger 切替
- 旧 `raw_fitbit__*` は CLAUDE.md の旧 raw 凍結方針に従い、別途 DROP 計画

### 判断2: breathing_rate の source_id
**仮決定: `sampleTime.physicalTime` を source_id にそのまま使う**

- 同一 sampleTime のデータポイントは1点しかないという仮定
- 反例見つかったら sha256(physicalTime + breaths_per_minute) に切替

### 判断3: backfill 範囲
**未決定**: Google Health が Fitbit 移行ユーザーの過去データをどこまで保持しているか要 probe
- 別セッション最初に `probe-google-health.mjs 365` 等で長期窓確認
- 取れるだけ取って全期間 backfill

### 判断4: stg の互換性
**仮決定: 新 stg `stg_google_health__*` を新設、旧 `stg_fitbit__*` と downstream で UNION ALL でつなぐ**
- 移行後は旧 stg を deprecate
- column の semantics は揃える（カラム名は新スキーマ準拠）

## 実装計画（別セッションでやること）

### Phase A: スキーマ（migration 1本） ✅ 完了 (migrations/019)
新規 migration `migrations/019_create_google_health_raw_tables.sql`:
1. **11個**（doc 当初の「10」は誤算 — activity 分割で 3 + exercise が独立で計 11）の `data_warehouse_v2.raw_google_health__*` テーブル CREATE
2. 各テーブルに対し `CALL data_warehouse_v2.create_raw_functions(...)` で tombstone/purge 自動生成 — DO ブロックで配列ループ
3. `apps/transform/models/staging/google_health/_google_health__sources.yml` に 11エントリ追加
4. `apps/transform/models/wrappers/raw_google_health__*_current.sql` を 11ファイル作成
   → `dbt run --select "wrappers.raw_google_health*"` PASS=11

### Phase B: connector 実装 ✅ 完了
`apps/connector/src/google_health/` 新設:

- **`oauth.ts`**
  - 既存 `fitbit/oauth.ts` をベースに、token URL を `https://oauth2.googleapis.com/token` に変更
  - refresh request は form-encoded（Basic auth でなく body に client_id/secret）
  - access_token 有効期限 1時間（Fitbit の 8時間から短くなる）→ refresh threshold は 10分前くらいに
  - service_name は `'google_health'`

- **`api-client.ts`**
  - Base: `https://health.googleapis.com/v4`
  - 共通 `listDataPoints(dataType, filter, accessToken)` を pageToken 自動追従で書く
  - 10 entity それぞれの fetch 関数を export
  - 各関数で適切な filter フィールド名（上の表）を使う
  - レート制限は未確認 → 一旦 1 req/200ms 程度に絞っておく

- **`sync.ts`**
  - 10 entity それぞれ `syncGoogleHealth<Entity>(days)` を実装
  - source_id 抽出ロジック（name 末尾 or sampleTime.physicalTime）
  - `appendRaw('raw_google_health__<entity>', source_id, data)` で書き込み
  - 旧 `fitbit/sync.ts` の `withTokyoOffset()` は呼ばない（UTC `Z` 付きでルール充足）

- **`main.ts` の trigger 関数**
  - `dailySyncGoogleHealth()` を新設、`syncGoogleHealthAll(7)` を呼ぶ
  - 移行期間中は両走（既存 `dailySync()` と並行）。9月直前に切替
  - `installTriggers()` に 13:00 JST 起動を追加（dailySync の 1h 後）

### Phase B 実装ノート（実装時に判明）

- **source_id 戦略は doc の表より粒度が必要**だった。probe の結果、`name` フィールドが存在するのは sleep / exercise のみ。残りは合成 ID:
  - steps / active_minutes / distance: `<type>.interval.startTime` (UTC Z ISO)
  - daily-*: civil date "YYYY-MM-DD" を `<typeCamel>.date: {year,month,day}` から生成
  - respiratory_rate_sleep_summary: `sampleTime.physicalTime`（依然プロビジョナル — probe で 0 datapoint）
- **filter フィールド名は doc の `civil_date` ではなく `.date`** が正解（probe で確認）
- **exercise** は `interval.civil_start_time` (no Z) が必須。`start_time` / `end_time` は filter 不可
- **raw 層に projection しない**方針。Google Health の response は既に typed/構造化されているので dataPoint 全体を `data` に格納。stg 層で展開
- access_token 有効期限は 1h、refresh threshold は **10 min before expiry**（Fitbit の 60min から短縮）

### Phase C: dbt models ✅ 完了
- `apps/transform/models/staging/google_health/` に **11 stg model**（respiratory も骨格だけ用意済、データが取れ次第使える状態）
- レスポンス shape を probe-out/ から確認して typed column に展開
- 既存 `stg_fitbit__*` の column 名は **完全には踏襲していない**（Google Health の構造を素直に表現することを優先、UNION compat layer は marts 直前で対応）
- `apps/transform/macros/google_health_civil_date.sql` で `{year, month, day}` JSONB を PG date に変換するヘルパー追加
- `dbt run --select "staging.google_health"` PASS=11、`dbt test` PASS=41

実装ノート:
- raw 層は dataPoint 全体を verbatim 保存しているので stg で `data->'sleep'->...` のように直接 JSONB path で抽出
- daily-* は `source_id::date` で OK、合わせて `civil_date` を Google の date object から組み立てた値も出力（一致性確認用）
- exercise の `activeDuration` は `"1179s"` 形式 → `rtrim('s')::numeric` で秒に変換
- 距離・歩数等は string 数値で来るので `::bigint` / `::numeric` cast

### Phase D: 動作確認 → カットオーバー
1. 並走で raw_google_health__* にデータ蓄積（数週間）
2. 旧 `raw_fitbit__*` と diff チェック（同じ日のデータが取れているか、欠損ないか）
3. 2026-09 直前: `main.ts` の `dailySync()` から Fitbit 呼び出しを除去
4. credentials テーブルの `service_name='fitbit'` 行を revoke + 削除
5. 旧 raw / stg / wrapper の DROP（別 migration）

## 未解決の TODO（別セッション最初にやる）

1. **`respiratory-rate-sleep-summary` の filter 構文確定**
   - `sample_time.physical_time` を probe で試す
   - ダメなら `dailyRollUp` endpoint で日付 bucket を取得する方式に変える
2. **過去データの backfill 可能範囲を確認**（365日とか試す）
3. **`daily-vo2-max` に実データがあるか長期窓で確認**
4. **rate limit の実測**（短時間に連打して 429 が返るか）
5. **`pageSize` の上限**（50 で動作確認済、もっと大きく？）

## 参考リンク

- Setup: https://developers.google.com/health/setup
- Endpoints: https://developers.google.com/health/endpoints
- Data types: https://developers.google.com/health/data-types
- Scopes: https://developers.google.com/health/scopes
- dataPoints.list reference: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
- Migration overview: https://developers.google.com/health/migration

## このセッションで追加されたファイル

- `scripts/auth-google-health.mjs`
- `scripts/probe-google-health.mjs`
- `scripts/probe-out/*.json`（11ファイル、`.gitignore` 検討）
- `docs/002_google_health_migration.md`（本ドキュメント）
