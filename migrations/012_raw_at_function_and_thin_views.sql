-- 012_raw_at_function_and_thin_views.sql
-- =============================================================================
-- Make raw_at(tbl, t) the canonical "as-of-T snapshot" implementation and
-- reduce every <table>_current view to a thin wrapper around it. After this
-- migration:
--
--   - Time-travel queries call raw_at(tbl, T) directly.
--   - Current-state queries continue to use <table>_current (same name as
--     before), but the view body is now `SELECT * FROM raw_at(tbl) WHERE
--     deleted = false AND purged = false` — single source of truth.
--
-- Why both: dbt sources / stg / LLM ad-hoc all expect a stable view name
-- per table. A pure-function approach would break source('raw_zaim',
-- 'raw_zaim__money_current') and clutter ad-hoc SQL with quoted table
-- names. Thin wrappers preserve the ergonomic surface while keeping the
-- projection logic in exactly one place.
--
-- Schema compatibility: the wrapper returns the same columns in the same
-- order as the previous DISTINCT-ON view, so `CREATE OR REPLACE VIEW`
-- works without a CASCADE drop and downstream stg views see no change.
--
-- The 23 tables covered match migrations 007 + 008 (every raw table that
-- migrated to data_warehouse_v2). Any future raw table added with the
-- standard 8-column shape can use raw_at(tbl) without changes here.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Canonical as-of-T projection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION data_warehouse_v2.raw_at(
  tbl text,
  t   timestamptz DEFAULT now()
)
RETURNS TABLE (
  source_id    text,
  revision     int,
  created_at   timestamptz,
  data         jsonb,
  content_hash text,
  deleted      boolean,
  purged       boolean,
  api_version  text
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT DISTINCT ON (source_id) source_id, revision, created_at, data,
            content_hash, deleted, purged, api_version
     FROM data_warehouse_v2.%I
     WHERE created_at <= $1
     ORDER BY source_id, revision DESC',
    tbl
  ) USING t;
END $$;

COMMENT ON FUNCTION data_warehouse_v2.raw_at(text, timestamptz) IS
  'Latest non-deleted-aware revision per source_id of the given raw table, '
  'as observed at time t (default now()). The deleted / purged filter is '
  'left to the caller so this same function can return tombstones too.';

-- ---------------------------------------------------------------------------
-- 2. Thin wrapper *_current views (replace existing definitions)
-- ---------------------------------------------------------------------------

-- Toggl Track (9 tables)
CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__time_entries_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__time_entries') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__time_entries_report_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__time_entries_report') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__projects_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__projects') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__clients_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__clients') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__tags_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__tags') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__me_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__me') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__workspaces_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__workspaces') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__users_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__users') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_toggl_track__groups_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_toggl_track__groups') WHERE deleted = false AND purged = false;

-- Fitbit (8 tables)
CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__activity_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__activity') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__breathing_rate_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__breathing_rate') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__cardio_score_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__cardio_score') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__heart_rate_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__heart_rate') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__hrv_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__hrv') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__sleep_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__sleep') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__spo2_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__spo2') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_fitbit__temperature_skin_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_fitbit__temperature_skin') WHERE deleted = false AND purged = false;

-- Tanita Health Planet (2 tables)
CREATE OR REPLACE VIEW data_warehouse_v2.raw_tanita_health_planet__blood_pressure_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_tanita_health_planet__blood_pressure') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_tanita_health_planet__body_composition_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_tanita_health_planet__body_composition') WHERE deleted = false AND purged = false;

-- Zaim (4 tables)
CREATE OR REPLACE VIEW data_warehouse_v2.raw_zaim__money_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_zaim__money') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_zaim__category_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_zaim__category') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_zaim__genre_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_zaim__genre') WHERE deleted = false AND purged = false;

CREATE OR REPLACE VIEW data_warehouse_v2.raw_zaim__account_current AS
SELECT * FROM data_warehouse_v2.raw_at('raw_zaim__account') WHERE deleted = false AND purged = false;

COMMIT;
