# data-warehouse

Personal data warehouse powered by Google Apps Script, Neon PostgreSQL, and dbt.

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
      toggl/        #   Toggl Track connector (API token auth)
      fitbit/       #   Fitbit connector (OAuth 2.0)
      tanita/       #   Tanita Health Planet connector (OAuth 2.0)
      zaim/         #   Zaim connector (OAuth 1.0a)
      lib/          #   Shared: HTTP client, Neon client, logger
      main.ts       #   GAS entry points & trigger setup
  transform/        # dbt project — staging views, dimensions, facts
    models/
      staging/      #   stg_* views (toggl_track, fitbit, tanita, zaim)
      dimensions/   #   dim_* views
      facts/        #   fct_* views
    seeds/          #   Category mapping CSVs
migrations/         # SQL DDL and data migration scripts
```

## GAS Triggers

| Trigger | Schedule | Scope |
|---------|----------|-------|
| `togglHourlySync` | Every hour | Toggl time entries (1 day) |
| `dailySync` | Daily 12:00 JST | Toggl masters + entries (3d) + Fitbit (7d) + Tanita (30d) + Zaim (30d) |
| `togglWeeklyHistoricalSync` | Monday 03:00 JST | Toggl report data (30 days) |
