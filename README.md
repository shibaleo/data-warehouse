# data-warehouse

SaaSに散在する個人データを一つのDBに集約し、分析基盤を構築するプロジェクト。
モダンデータスタックのデザインパターン（ELT、raw/staging/dimension/factレイヤリング、冪等upsert、dbtによる変換）を踏襲しつつ、個人利用に適したインフラ（GAS + Neon free tier）とデータモデルを採用している。

## Architecture

```
Toggl Track API ──┐
Fitbit Web API ───┤
Health Planet API ─┼── GAS (clasp/TS) ── Neon SQL over HTTP ──► Neon PostgreSQL
Zaim API ─────────┘        ↑ time triggers                     data_warehouse.*
                                                                 raw_*  (tables)
                           dbt (local) ────────────────────────► stg_*  (views)
                                                                 dim_*  (views)
                                                                 fct_*  (views)

                           Grafana Cloud ◄──── PostgreSQL ─────► Dashboards
```

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
| **Fitbit** | OAuth 2.0 | Sleep, activity, heart rate, HRV, SpO2, breathing rate, cardio score, skin temperature |
| **Tanita Health Planet** | OAuth 2.0 | Body composition (weight, body fat %), blood pressure (systolic, diastolic, pulse) |
| **Zaim** | OAuth 1.0a | Transactions (income/payment/transfer), categories, genres, accounts |

## dbt Models

### Staging (`stg_*`)
Source data cleaned and typed. One view per raw table.

### Dimensions (`dim_*`)
- `dim_time_projects` — Toggl projects with client/category mapping
- `dim_category_time_personal` / `_coarse` — Personal time category hierarchy
- `dim_category_time_social` — Social time categories

### Facts (`fct_*`)
- `fct_time_records_actual` — Time records with category mapping and gap filling
- `fct_time_records_actual_split` — Time records split by JST day boundary
- `fct_health_sleep` — Daily sleep (Fitbit main sleep, one row per date)
- `fct_health_body` — Daily body composition (Tanita, one row per date)
- `fct_zaim_transactions` — Zaim transactions with category/genre/account names

## Project Structure

```
apps/
  connector/        # GAS project — data collection from APIs to Neon
    src/
      toggl/        #   Toggl Track connector (API token in credentials table)
      fitbit/       #   Fitbit connector (OAuth 2.0, token refresh via GAS)
      tanita/       #   Tanita Health Planet connector (OAuth 2.0, token refresh via GAS)
      zaim/         #   Zaim connector (OAuth 1.0a, tokens never expire)
      lib/          #   Shared: HTTP client, Neon client, logger
      config.ts     #   GAS script properties (DATABASE_URL only)
      main.ts       #   GAS entry points & trigger setup
  transform/        # dbt project — staging views, dimensions, facts
    models/
      staging/      #   stg_* views (toggl_track, fitbit, tanita, zaim)
      dimensions/   #   dim_* views
      facts/        #   fct_* views
    seeds/          #   Category mapping CSVs
migrations/         # SQL DDL for creating schema from scratch
```

## Credentials

All service credentials are stored in `data_warehouse.credentials` table. GAS reads them at runtime via Neon SQL over HTTP.

| service_name | auth type | metadata |
|---|---|---|
| `fitbit` | OAuth 2.0 | — |
| `tanita_health_planet` | OAuth 2.0 | `redirect_uri` |
| `zaim` | OAuth 1.0a | `access_token_secret` |
| `toggl_track` | API token | `workspace_id` |

GAS script properties only contain `DATABASE_URL` (Neon connection string).

## GAS Triggers

| Trigger | Schedule | Scope |
|---------|----------|-------|
| `togglHourlySync` | Every hour | Toggl time entries (1 day) |
| `dailySync` | Daily 12:00 JST | Toggl masters + entries (3d) + Fitbit (7d) + Tanita (30d) + Zaim (30d) |
| `togglWeeklyHistoricalSync` | Monday 03:00 JST | Toggl report data (30 days) |

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |

`.env` に配置。GAS側は script properties に `DATABASE_URL` のみ設定。

## Migrations

DDL files in `migrations/` create the schema from scratch:

1. `001_create_raw_tables.sql` — Toggl Track raw tables
2. `002_create_credentials.sql` — Credentials table (with metadata JSONB)
3. `003_create_fitbit_raw_tables.sql` — Fitbit raw tables
4. `004_create_tanita_raw_tables.sql` — Tanita Health Planet raw tables
5. `006_create_zaim_raw_tables.sql` — Zaim raw tables

## Roadmap

- **データソース拡充**: 新たなSaaS/APIからのデータ収集を追加
