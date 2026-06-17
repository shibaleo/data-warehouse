-- 020_freeze_fitbit_tables.sql
-- =============================================================================
-- Freeze raw_fitbit__* tables read-only.
--
-- Google Health backfill (docs/004_bug_fix.md) reproduced raw_fitbit__sleep
-- from 2020-06 onwards with only 3-night drift attributable to session-
-- boundary heuristics. The Fitbit connector has been removed from
-- apps/connector/. These tables are now historical-archive only — no new
-- writes should ever land here.
--
-- This goes beyond 017_append_only_protection (which only blocks UPDATE /
-- DELETE) by also blocking INSERT and TRUNCATE. We keep the tables for
-- (a) the ~3 dates only Fitbit observed and (b) audit/comparison with
-- raw_google_health__* if a future drift investigation needs it.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION data_warehouse_v2.raise_frozen_violation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'frozen: % on %.% is forbidden (read-only archive)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

COMMENT ON FUNCTION data_warehouse_v2.raise_frozen_violation() IS
  'Trigger handler that blocks INSERT / UPDATE / DELETE / TRUNCATE on '
  'fully-frozen tables (read-only archives).';

-- Schema-aware (unlike 017's enable_append_only_protection which assumes
-- dwh_cfg('schema_name')) because raw_fitbit__* exist in both
-- data_warehouse (legacy) and data_warehouse_v2.
CREATE OR REPLACE PROCEDURE data_warehouse_v2.enable_frozen_protection(schema_name text, tbl text)
LANGUAGE plpgsql AS $proc$
BEGIN
  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS %2$I_no_insert   ON %1$I.%2$I;
    DROP TRIGGER IF EXISTS %2$I_no_update   ON %1$I.%2$I;
    DROP TRIGGER IF EXISTS %2$I_no_delete   ON %1$I.%2$I;
    DROP TRIGGER IF EXISTS %2$I_no_truncate ON %1$I.%2$I;

    CREATE TRIGGER %2$I_no_insert
      BEFORE INSERT ON %1$I.%2$I
      FOR EACH ROW EXECUTE FUNCTION data_warehouse_v2.raise_frozen_violation();
    CREATE TRIGGER %2$I_no_update
      BEFORE UPDATE ON %1$I.%2$I
      FOR EACH ROW EXECUTE FUNCTION data_warehouse_v2.raise_frozen_violation();
    CREATE TRIGGER %2$I_no_delete
      BEFORE DELETE ON %1$I.%2$I
      FOR EACH ROW EXECUTE FUNCTION data_warehouse_v2.raise_frozen_violation();
    CREATE TRIGGER %2$I_no_truncate
      BEFORE TRUNCATE ON %1$I.%2$I
      FOR EACH STATEMENT EXECUTE FUNCTION data_warehouse_v2.raise_frozen_violation();
  $sql$, schema_name, tbl);
END $proc$;

COMMENT ON PROCEDURE data_warehouse_v2.enable_frozen_protection(text, text) IS
  'Adds BEFORE INSERT / UPDATE / DELETE / TRUNCATE triggers that block all '
  'mutations on the given table. Use for fully-frozen archive tables. '
  'Disabling requires explicit DROP TRIGGER in a follow-up migration.';

-- Apply to all raw_fitbit__* tables in both schemas.
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__activity');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__breathing_rate');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__cardio_score');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__heart_rate');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__hrv');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__sleep');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__spo2');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse_v2', 'raw_fitbit__temperature_skin');

CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__activity');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__breathing_rate');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__cardio_score');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__heart_rate');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__hrv');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__sleep');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__spo2');
CALL data_warehouse_v2.enable_frozen_protection('data_warehouse', 'raw_fitbit__temperature_skin');

COMMIT;
