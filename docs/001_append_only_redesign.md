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

### Phase 1: Toggl raw を新スキーマに切替 ✅ 完了 (2026-05-01)

- [x] **Migration 起票**: `migrations/007_append_only_toggl_raw.sql`
  - 新スキーマ `data_warehouse_v2` で 9 テーブル (`time_entries` / `time_entries_report` / `projects` / `clients` / `tags` / `me` / `workspaces` / `users` / `groups`) を新設
  - 現データを revision=1, created_at=synced_at, content_hash=md5((data - 'at')::text), deleted=false で取り込み
  - 過去履歴 (UPSERT で消えた分) は失われている前提で受容
- [x] **Connector lib 改修**: `apps/connector/src/lib/neon-client.ts`
  - `upsertRaw` → `appendRaw` に置換
  - **content_hash は DB 側で計算** (`md5((data - 'at')::text)`)。JS / PG 間の正規化乖離を排除し、backfill と runtime で byte-identical な hash を保証
  - 差分削除: 上流で消えた source_id には deleted=true の新 revision を INSERT (UPDATE しない)
  - 安全装置: API レスポンス空のとき差分削除スキップ / `created_at < now() - 5min` grace
- [x] **Toggl sync コード**: `apps/connector/src/toggl/sync-masters.ts`, `sync-time-entries.ts`, `sync-time-entries-report.ts`
  - 呼び出しを `appendRaw` に変更
  - cross-table cleanup (Track 残骸を Reports 由来でtombstone) も append-only に置換
- [x] **Staging view 改修**: `apps/transform/models/staging/toggl_track/stg_toggl_track__*.sql`
  - source を `<table>_current` view 経由に変更 (`schema: data_warehouse_v2`)
  - 旧 `id`(UUID) カラム参照を削除、`synced_at` を `created_at as synced_at` で alias して下流互換維持
- [x] **本番マイグレーション実行 + スモークテスト**
  - 旧 9 テーブル 22,323 行 → 新 _current view 行数完全一致
  - GAS にデプロイ後、手動 togglHourlySync で `appended=0 tombstoned=0` (= `at` 違いだけでは revision 増えない) を実証
- [x] **commit**: `260a00f` Convert Toggl raw layer to append-only / uni-temporal

### Phase 2: 他ドメインに横展開 ✅ 完了 (2026-05-01)

- [x] Fitbit (8) / Tanita (2) / Zaim (4) の raw を同じパターンに移行 (`migrations/008_append_only_fitbit_tanita_zaim.sql`)
  - 14 テーブル backfill 行数: fitbit 11,936 / tanita 656 / zaim 3,452 — 全件旧と一致
- [x] 各 stg view を更新 (8 fitbit + 2 tanita + 4 zaim)
- [x] connector sync 3 ファイル (`fitbit/sync.ts`, `tanita/sync.ts`, `zaim/sync.ts`) を `appendRaw` 化
- [x] **下流 fct 修正**: `fct_health_sleep` / `fct_health_body` / `fct_zaim_transactions` の `id` 参照を `md5(source_id::text)::uuid` に置換 (旧 raw `id` UUID は v2 に存在しないため)
- [x] **commit**: `7dd8d5e` Extend append-only raw layer to Fitbit, Tanita, and Zaim

#### Phase 2 中の事故と緊急対応

Phase 1 deploy 直後、`upsertRaw` を lib から削除したまま fitbit/tanita/zaim sync コードが旧シンボルを参照していたため、明朝の dailySync で `ReferenceError` で爆発する状態にあった。

- 一時的に `upsertRaw` shim (旧 `data_warehouse.*` 向け UPSERT) を `neon-client.ts` に復活、即 clasp push で延命
- Phase 2 完了と同時に shim 削除版を再 push、現在は全 caller が `appendRaw` 経由

教訓: lib の関数シグネチャを変える際は、grep で全 caller を洗い出してから変更を deploy する。今回のように旧名と新名を共存させる方が安全。

### Phase 3: 解釈層の解体 — **スキップ** (2026-05-01 決定)

DWH 側の `data_warehouse_v2.fct_*/rpt_*` は **deprecate by neglect** で放置する方針に変更。
新アプリ側で独自の dim/fct/rpt を組み立てるので、既存 DWH 解釈層は使われなくなり次第自然に枯れる。
明示的な migration は行わない (cost 高い割に得るものが少ない)。

- ~~dbt の `fct_*/rpt_*` を data_presentation から外す~~
- ~~`mst_time_targets.csv` 等 seed をアプリ側 (Supabase) に移行~~
- ~~data-warehouse は raw + stg のみに絞る~~

### Phase 4: 新アプリ (time-goals) 着手 (未着手)

- [ ] 新リポジトリ作成 (CF Pages + Workers + Hono)
- [ ] Supabase 既存プロジェクトに `time_goals` schema 追加 (Pattern 2 で実装)
- [ ] Neon `data_warehouse_v2.*_current` を read-only で参照

**Phase 1-3 は data-warehouse 側、Phase 4 が新アプリ側。Phase 1 完了が新アプリ着手の前提。**

### 残タスク

- [ ] **2026-05-15 頃**: 旧 `data_warehouse.raw_*` (toggl 9 + fitbit 8 + tanita 2 + zaim 4 = 23 テーブル) を DROP
  - 旧スキーマは Phase 1 / 2 deploy 以降書き込まれていない (rollback 観察期間用に凍結)
  - 2 週間スモークテストで append-only 側の不具合がなければ確定削除
- [ ] **GAS hourly trigger 失敗通知** が ON か確認 (Reports sync が止まっても気づける運用にするため)

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

## 実装結果サマリ (2026-05-01 時点)

### 移行済みテーブル一覧 (`data_warehouse_v2`)

| Source | テーブル数 | _current 行数 |
|---|---|---|
| Toggl Track | 9 (time_entries / time_entries_report / projects / clients / tags / me / workspaces / users / groups) | 22,323 |
| Fitbit | 8 (activity / breathing_rate / cardio_score / heart_rate / hrv / sleep / spo2 / temperature_skin) | 11,936 |
| Tanita Health Planet | 2 (blood_pressure / body_composition) | 656 |
| Zaim | 4 (money / category / genre / account) | 3,452 |
| **合計** | **23 テーブル + 23 _current views** | **38,367 行** |

### 動作実績

- 全 23 テーブルで旧スキーマ行数と新 `_current` view 行数が完全一致
- 手動 togglHourlySync (Track v9, 2 日窓) で `appended=0 tombstoned=0` を観測
  - = 同 source_id で `at` 以外が同じなら revision を増やさない、append-only の核仕様が稼働
- dbt 33 model 全て新 sources 経由で再ビルド成功
- 旧 `data_warehouse.raw_*` 23 テーブルは凍結状態 (sync writes 0)、rollback 観察用に残置

### 関連 commit

- `260a00f` — Phase 1: Toggl raw を append-only / uni-temporal in data_warehouse_v2 に変換
- `7dd8d5e` — Phase 2: Fitbit / Tanita / Zaim も同パターンに横展開、`upsertRaw` shim 緊急対応も同梱

### 関連ファイル

- `migrations/007_append_only_toggl_raw.sql` — Toggl 9 テーブル (Phase 1)
- `migrations/008_append_only_fitbit_tanita_zaim.sql` — 残り 14 テーブル (Phase 2)
- `apps/connector/src/lib/neon-client.ts` — `appendRaw` / `differentialDelete` / `tombstoneMissing`
- `apps/connector/src/{toggl,fitbit,tanita,zaim}/sync*.ts` — 各ドメインの呼び出し側
- `apps/transform/models/staging/{toggl_track,fitbit,tanita_health_planet,zaim}/` — `_current` view 経由の stg
- `scripts/resync-toggl-report.mjs` — ローカル historical resync (append-only 対応版)
