# data-warehouse

SaaSに散在する個人データを一つのDBに集約し、分析基盤を構築するプロジェクト。
モダンデータスタックのデザインパターン（ELT、raw/staging/dimension/factレイヤリング、冪等upsert、dbtによる変換）を踏襲しつつ、個人利用に適したインフラ（GAS + Neon free tier）とデータモデルを採用している。

## Architecture

```
Toggl Track API ──┐
Fitbit Web API ───┤  (shutdown 2026-09; running parallel with Google Health until cutover)
Google Health API ┤
Health Planet API ─┼── GAS (clasp/TS) ── Neon SQL over HTTP ──► Neon PostgreSQL
Zaim API ─────────┘        ↑ time triggers                     data_warehouse_v2.*
                                                                 raw_*  (append-only tables)
                           dbt (local) ────────────────────────► stg_*, dim_*  (views, data_warehouse)
                                                                 fct_*, rpt_*  (views, data_presentation)

                           Grafana Cloud ◄──── PostgreSQL ─────► Dashboards
```

詳細は [docs/001_append_only_redesign.md](docs/001_append_only_redesign.md)（append-only / bitemporal）と
[docs/002_google_health_migration.md](docs/002_google_health_migration.md)（Fitbit → Google Health 移行）参照。

## Stack

| Layer | Tool |
|-------|------|
| Data collection | Google Apps Script (TypeScript via clasp) |
| Storage | Neon PostgreSQL (free tier) |
| Credential management | Neon `data_warehouse.credentials` table |
| Transformation | dbt-postgres |
| Visualization | Grafana Cloud |
| Scheduling | GAS time-driven triggers |

## Data Sources

| Source | Auth | Data |
|--------|------|------|
| **Toggl Track** | API token | Time entries, projects, clients, tags, users, workspaces |
| **Fitbit** *(shutdown 2026-09)* | OAuth 2.0 | Sleep, activity, heart rate, HRV, SpO2, breathing rate, cardio score, skin temperature |
| **Google Health** *(Fitbit 後継、両走中)* | OAuth 2.0 | sleep, steps, distance, active_minutes, exercise, daily_resting_heart_rate, daily_heart_rate_variability, daily_oxygen_saturation, respiratory_rate_sleep_summary, daily_vo2_max, daily_sleep_temperature_derivations |
| **Tanita Health Planet** | OAuth 2.0 | Body composition (weight, body fat %), blood pressure (systolic, diastolic, pulse) |
| **Zaim** | OAuth 1.0a | Transactions (income/payment/transfer), categories, genres, accounts |

## dbt Models

### Staging (`stg_*`)
Source data cleaned and typed. One view per raw table.

### Dimensions (`dim_*`)
- `dim_time_projects` — Toggl projects with client/category mapping
- `dim_category_time_personal` / `_coarse` — Personal time category hierarchy
- `dim_category_time_social` — Social time categories

### Facts (`fct_*`) — schema: `data_presentation`
DCMP (data-composition) へのパブリック API。FK 解決のみ。合成行・補正なし。

- `fct_toggl_time_entries` — Toggl 時間記録（DCMP 登録用）
- `fct_health_sleep` — Daily sleep (Fitbit main sleep, one row per date)
- `fct_health_body` — Daily body composition (Tanita, one row per date)
- `fct_zaim_transactions` — Zaim transactions with category/genre/account names

### Reports (`rpt_*`) — schema: `data_presentation`
可視化・集計専用。DCMP は参照しない。

- `rpt_time_records_continuous` — ギャップ補正済み連続タイムライン（旧 `fct_time_records_actual`）
- `rpt_time_records_continuous_split` — 日跨ぎ分割版

## Project Structure

```
apps/
  connector/        # GAS project — data collection from APIs to Neon
    src/
      toggl/        #   Toggl Track connector (API token in credentials table)
      fitbit/       #   Fitbit connector (OAuth 2.0) — frozen, shutdown 2026-09
      google_health/#   Google Health connector (OAuth 2.0, Fitbit 後継)
      tanita/       #   Tanita Health Planet connector (OAuth 2.0, token refresh via GAS)
      zaim/         #   Zaim connector (OAuth 1.0a, tokens never expire)
      lib/          #   Shared: HTTP client, Neon client, logger
      config.ts     #   GAS script properties (DATABASE_URL only)
      main.ts       #   GAS entry points & trigger setup
  transform/        # dbt project — staging views, dimensions, facts/reports
    models/
      staging/      #   stg_* views (toggl_track, fitbit, tanita, zaim)  → data_warehouse
      dimensions/   #   dim_* views                                       → data_warehouse
      facts/        #   fct_* views (DCMP 公開 API)                       → data_presentation
      reports/      #   rpt_* views (可視化専用)                           → data_presentation
    seeds/          #   Category mapping CSVs
migrations/         # SQL DDL for creating schema from scratch
```

## Credentials

All service credentials are stored in `data_warehouse.credentials` table. GAS reads them at runtime via Neon SQL over HTTP.

| service_name | auth type | metadata |
|---|---|---|
| `fitbit` | OAuth 2.0 | — *(凍結予定: 2026-09 shutdown)* |
| `google_health` | OAuth 2.0 | — |
| `tanita_health_planet` | OAuth 2.0 | `redirect_uri` |
| `zaim` | OAuth 1.0a | `access_token_secret` |
| `toggl_track` | API token | `workspace_id` |

GAS script properties only contain `DATABASE_URL` (Neon connection string).

## GAS Triggers

| Trigger | Schedule | Scope |
|---------|----------|-------|
| `togglHourlySync` | Every hour | Toggl time entries (1 day) |
| `dailySync` | Daily 12:00 JST | Toggl masters + entries (3d) + Fitbit (7d) + Tanita (30d) + Zaim (30d) |
| `dailySyncGoogleHealth` | Daily 13:00 JST | Google Health 全 11 entity (7d) — Fitbit 並走 |
| `togglWeeklyHistoricalSync` | Monday 03:00 JST | Toggl report data (30 days) |

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string（pooler なし） |
| `NEON_HOST` | Neon ホスト名（dbt profiles.yml が参照） |
| `NEON_USER` | Neon ユーザー名 |
| `NEON_PASSWORD` | Neon パスワード |
| `NEON_DB` | データベース名（デフォルト: `neondb`） |

`.env` に配置（プロジェクトルート）。GAS 側は script properties に `DATABASE_URL` のみ設定。

## Running dbt

```bash
# プロジェクトルートで .env を読み込んでから実行
source .env && cd apps/transform && dbt run

# 特定モデルのみ
source .env && cd apps/transform && dbt run --select facts

# 接続テスト
source .env && cd apps/transform && dbt debug
```

> `run_dbt.py` は `.env` の読み込みを担うラッパーだが、`dbt` コマンドのパス解決の問題により現在は `source .env` での直接実行を推奨。

## Migrations

DDL files in `migrations/` create the schema from scratch. 番号順に適用:

- `001`〜`006` — 初期 raw テーブル群 (Toggl / Fitbit / Tanita / Zaim) + credentials
- `007`〜`008` — append-only redesign (旧 UPSERT 経路を `data_warehouse_v2` に移行)
- `009`〜`010` — タイムゾーン補正 (Fitbit sleep / Zaim)
- `011` — 揮発性 master 列の除去
- `012` — `raw_at(tbl, T)` 関数 + thin `_current` view
- `013` — Pattern 2 (bitemporal dim) basis
- `014` — `dwh_config` テーブル / `dwh_cfg(key)` 関数
- `015`〜`016` — `create_raw_functions` / `create_dim_functions` factory procedures
- `017` — opt-in append-only protection trigger
- `018` — pgtap install
- `019` — Google Health raw tables (11 entity)

詳細は [CLAUDE.md](CLAUDE.md) と各 docs/ を参照。

## Roadmap

- **データソース拡充**: 新たなSaaS/APIからのデータ収集を追加
