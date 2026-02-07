# data-warehouse

Personal data warehouse powered by Google Apps Script, Neon PostgreSQL, and dbt.

## Architecture

```
Toggl Track API ──┐
                  ├── GAS (clasp/TS) ── Neon SQL over HTTP ──► Neon PostgreSQL
Fitbit Web API ───┘        ↑ time triggers                     data_warehouse.*
                                                                 raw_*  (tables)
                           dbt (local) ────────────────────────► stg_*  (views)
                                                                 dim_*  (views)
                                                                 fct_*  (views)
```

## Stack

| Layer | Tool |
|-------|------|
| Data collection | Google Apps Script (TypeScript via clasp) |
| Storage | Neon PostgreSQL (free tier) |
| Transformation | dbt-postgres |
| Scheduling | GAS time-driven triggers |

## Data Sources

- **Toggl Track** — Time entries, projects, clients, tags, users, workspaces
- **Fitbit** — Sleep, activity, heart rate, HRV, SpO2, breathing rate, cardio score, skin temperature

## Project Structure

```
apps/
  connector/    # GAS project — data collection from APIs to Neon
  transform/    # dbt project — staging views, dimensions, facts
migrations/     # SQL DDL and one-off migration scripts
```
