# raw 層を append-only / bitemporal に再設計

作成日: 2026-05-01

## 背景

現状の raw 層は `source_id` UNIQUE + UPSERT で「最新の観察」しか保持しない。Toggl で project の名前や色を変更すると、過去の観察は GAS sync 時に上書きされる。これは DWH 原則「raw は不変 = 過去取得した観察を改変しない」に反している。

問題:
- 過去エントリの分類根拠が時間とともに動く
- 「2025-12 時点で project の色は何だった?」が答えられない
- 解釈レイヤ (新アプリ time-goals 等) が bitemporal を採用しても、基盤の raw が可変だと意味が崩れる

**方針: raw を真の append-only にし、master 変動を観察履歴として保持する。**

## 2 つのパターン

| 用途 | パターン | 特徴 |
|---|---|---|
| サービス取得 raw (Toggl/Fitbit/Tanita/Zaim) | **Pattern 1: uni-temporal** | transaction time のみ |
| 時間追跡を要するオリジナルデータ (アプリ層 dim) | **Pattern 2: bitemporal** | + business time |

差分は `valid_from` 列の有無のみ。Pattern 2 ⊃ Pattern 1。

### Pattern 1: サービス raw

```
source_id     TEXT          -- 外部 API の native ID
revision      INT           -- 同 source_id 内の append 順序 (1, 2, 3, ...)
created_at    TIMESTAMPTZ   -- system: INSERT 時 now()
data          JSONB         -- 観察した内容
content_hash  TEXT          -- data の hash (変化検出用)
deleted       BOOLEAN       -- lifecycle (上流で消えた)
purged        BOOLEAN       -- lifecycle (確定削除)
api_version   TEXT

PRIMARY KEY (source_id, revision)
CHECK: 各 source_id について purged=true は ≤1 行
```

### Pattern 2: アプリ層 dim (bitemporal)

```
id            UUID          -- entity identity
revision      INT
created_at    TIMESTAMPTZ   -- system (= transaction time)
valid_from    TIMESTAMPTZ   -- business: ユーザー指定可 (過去/今/未来自由)
<content fields>
deleted       BOOLEAN
purged        BOOLEAN

PRIMARY KEY (id, revision)
```

## ライフサイクル (両パターン共通)

```
create  → revision=1, deleted=f, purged=f
update  → revision=2, deleted=f, purged=f
delete  → revision=3, deleted=t, purged=f   (soft, 復元可能)
restore → revision=4, deleted=f, purged=f
purge   → revision=5, deleted=t, purged=t   (確定、UNIQUE で 1 回限り)
```

**UPDATE 禁止**。すべての状態変化は新行 INSERT。

## 派生 view / クエリパターン

```sql
-- 現在有効な行 (= 最新 revision で deleted=false)
CREATE VIEW <table>_current AS
SELECT * FROM (
  SELECT DISTINCT ON (source_id) *
  FROM <table>
  ORDER BY source_id, revision DESC
) t
WHERE deleted = false AND purged = false;

-- T 時点の transaction-time スナップショット
SELECT DISTINCT ON (source_id) *
FROM <table>
WHERE created_at <= T
ORDER BY source_id, revision DESC;

-- bitemporal (Pattern 2 専用)
SELECT * FROM <table>
WHERE id = X
  AND valid_from <= <business_time>
  AND created_at <= <transaction_time>  -- 省略時は now()
ORDER BY revision DESC LIMIT 1;
```

`valid_until` / `superseded_at` は **物理列として持たない**。LEAD() で derive。

## 今回スコープ: Toggl raw 層から

優先: `time_entries`, `projects`, `clients`, `tags`
後回し可: `workspaces`, `users`, `groups`, `me` (流動性低)

## CRUD 責任分担

| 層 | CRUD 担当 | 実装 |
|---|---|---|
| raw (Toggl 等サービス取得) | 既存 GAS connector | `appendRaw` への改修のみ。新アプリ不要 |
| dim (categories, mappings, targets) | 新アプリ time-goals | Hono の CRUD endpoint (CF Workers) |
| 読み取り (集計、可視化) | time-goals / mcpist | 直接 PG read |

connector は GAS 維持。append-only 化は SQL ロジック差し替えで済むので CF Worker への移行は不要 (個人用途の Toggl Report API バッチ量は CF / GAS どちらでも余裕)。

## DB-level 強制 (ロール分離)

探索的開発期間中は **省略**。リリース時に `connector_role` (INSERT only) / `readonly_role` などの分離を導入する。それまでは:
- アプリコード規律 (Drizzle で UPDATE/DELETE を呼ばない)
- `content_hash` チェーンで事後検出 (stockflow と同等)
の 2 層で運用。

## 今後やること (TODO)

### Phase 1: Toggl raw を新スキーマに切替

- [ ] **Migration 起票**: `migrations/007_append_only_toggl_raw.sql`
  - 新スキーマで `raw_toggl_track__*` を作り直し
  - 現データを revision=1, created_at=synced_at, deleted=false で取り込み
  - 過去履歴 (UPSERT で消えた分) は失われている前提で受容
- [ ] **Connector lib 改修**: `apps/connector/src/lib/neon-client.ts`
  - `upsertRaw` → `appendRaw` に置換
  - 内部: content_hash 計算 → 同 source_id の最新 revision と比較 → 異なれば INSERT、同じなら no-op
  - 差分削除: 上流で消えた source_id には deleted=true の新 revision を INSERT (UPDATE しない)
- [ ] **Toggl sync コード**: `apps/connector/src/toggl/sync-masters.ts`, `sync-time-entries.ts`
  - 呼び出しを `appendRaw` に変更
- [ ] **Staging view 改修**: `apps/transform/models/staging/toggl_track/stg_toggl_track__*.sql`
  - source を `<table>_current` view 経由に変更
- [ ] **本番マイグレーション実行 + スモークテスト**

### Phase 2: 他ドメインに横展開

- [ ] Fitbit / Tanita / Zaim の raw を同じパターンに移行
- [ ] 各 stg view を更新

### Phase 3: 解釈層の解体

- [ ] dbt の `fct_*/rpt_*` を data_presentation から外す
- [ ] `mst_time_targets.csv` 等 seed をアプリ側 (Supabase) に移行
- [ ] data-warehouse は raw + stg のみに絞る

### Phase 4: 新アプリ (time-goals) 着手

- [ ] 新リポジトリ作成 (CF Pages + Workers + Hono)
- [ ] Supabase 既存プロジェクトに `time_goals` schema 追加 (Pattern 2 で実装)
- [ ] Neon `data_warehouse.stg_*_current` を read-only で参照

**Phase 1-3 は data-warehouse 側、Phase 4 が新アプリ側。Phase 1 完了が新アプリ着手の前提。**

## 設計判断の記録

- **`updated_at` ではなく `created_at`**: append-only では行は更新されない。各行は「作られた時刻」しか持たないので名前としては `created_at` が正確
- **revision int を採用 (timestamp 順序にしない)**: clock skew / 同時刻 tie を構造的に防ぐ。`(id, revision)` UNIQUE で race を制約レベルで弾く
- **`valid_until` / `superseded_at` を物理列にしない**: append-only を破る (UPDATE が必要) ため、window 関数 (LEAD) で derive
- **purge を物理削除と分ける**: 「無かったことにする」を append-only の枠内で表現。CHECK 制約で 1 回限り。GDPR 的要請も同じ枠組みで対応可
- **`valid_from` を business 列として明示**: system メタ (`created_at`) と意味的に分離。retroactive 訂正は revision+1 + 過去日付の `valid_from` で表現

## 関連: 新アプリ time-goals

新アプリの中心は「進捗表示」ではなく「**カテゴリ・マッピング・目標の動的編集**」。マスタが時間とともに進化することそのものを観察する設計。Pattern 2 (bitemporal) でこれを表現する。

raw が Pattern 1 で append-only になっていれば「過去のエントリは過去のマスタで分類」という意味が保てる。逆に raw が UPSERT のままだと、新アプリ側 bitemporal の意味が壊れる。

詳細は `MEMORY.md` の `project_time_goals_app.md` を参照 (Claude Code の memory 領域)。
