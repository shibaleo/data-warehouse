-- 019_create_google_health_raw_tables.sql
-- =============================================================================
-- Google Health API raw tables (Fitbit Web API successor; Fitbit shutdown 2026-09).
-- Append-only / uni-temporal shape, identical to the data_warehouse_v2.raw_*
-- pattern established in 008/015. Each table gets per-table tombstone/purge
-- helpers via create_raw_functions().
--
-- See docs/002_google_health_migration.md for the mapping from Fitbit dataTypes
-- to Google Health dataTypes and source_id strategy per entity.
--
-- 11 tables:
--   sleep
--   steps, active_minutes, distance       (split from Fitbit activity)
--   exercise
--   daily_resting_heart_rate
--   daily_heart_rate_variability
--   daily_oxygen_saturation
--   respiratory_rate_sleep_summary
--   daily_vo2_max                         (Fitbit cardio_score equivalent)
--   daily_sleep_temperature_derivations
--
-- TZ note: Google Health responses use physicalTime in UTC ("Z") with a
-- separate utcOffset field. The "Z" suffix already satisfies the CLAUDE.md
-- offset-required rule, so connector does NOT need withOffset() backfill.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  entities text[] := ARRAY[
    'sleep',
    'steps',
    'active_minutes',
    'distance',
    'exercise',
    'daily_resting_heart_rate',
    'daily_heart_rate_variability',
    'daily_oxygen_saturation',
    'respiratory_rate_sleep_summary',
    'daily_vo2_max',
    'daily_sleep_temperature_derivations'
  ];
  entity text;
  tbl    text;
BEGIN
  FOREACH entity IN ARRAY entities LOOP
    tbl := 'raw_google_health__' || entity;

    EXECUTE format($f$
      CREATE TABLE data_warehouse_v2.%1$I (
        source_id    TEXT        NOT NULL,
        revision     INT         NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        data         JSONB       NOT NULL,
        content_hash TEXT        NOT NULL,
        deleted      BOOLEAN     NOT NULL DEFAULT false,
        purged       BOOLEAN     NOT NULL DEFAULT false,
        api_version  TEXT        DEFAULT 'v4',
        PRIMARY KEY (source_id, revision)
      )
    $f$, tbl);

    EXECUTE format($f$
      CREATE UNIQUE INDEX %1$I
        ON data_warehouse_v2.%2$I (source_id) WHERE purged = true
    $f$, tbl || '_purge_unique', tbl);

    EXECUTE format($f$
      CREATE INDEX %1$I
        ON data_warehouse_v2.%2$I (source_id, revision DESC)
    $f$, tbl || '_source_revision_desc', tbl);

    EXECUTE format($f$CALL data_warehouse_v2.create_raw_functions(%1$L)$f$, tbl);
  END LOOP;
END $$;

COMMIT;
