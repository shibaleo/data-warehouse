-- 017_append_only_protection.sql
-- =============================================================================
-- Opt-in trigger that blocks UPDATE and DELETE on append-only tables.
--
-- Default policy is "off" — append-only is enforced by app discipline so far.
-- Once a table is "settled" (no pending corrections / backfills / shape
-- changes), call enable_append_only_protection('<tbl>') to lock it down at
-- the DB layer. The trigger then raises an exception on any UPDATE or
-- DELETE, no matter the role or session.
--
-- This is one-way per the boilerplate's stance: there is no
-- disable_append_only_protection helper. If you really need to drop the
-- triggers (e.g. to fix a one-off backfill bug), do it explicitly:
--   DROP TRIGGER <tbl>_no_update ON <schema>.<tbl>;
--   DROP TRIGGER <tbl>_no_delete ON <schema>.<tbl>;
-- so the intent shows up in the migration history.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION data_warehouse_v2.raise_append_only_violation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on %.% is forbidden',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

COMMENT ON FUNCTION data_warehouse_v2.raise_append_only_violation() IS
  'Trigger handler that blocks UPDATE and DELETE on protected tables.';

CREATE OR REPLACE PROCEDURE data_warehouse_v2.enable_append_only_protection(tbl text)
LANGUAGE plpgsql AS $proc$
DECLARE
  schema_name text := public.dwh_cfg('schema_name');
BEGIN
  EXECUTE format($sql$
    DROP TRIGGER IF EXISTS %2$I_no_update ON %1$I.%2$I;
    DROP TRIGGER IF EXISTS %2$I_no_delete ON %1$I.%2$I;

    CREATE TRIGGER %2$I_no_update
      BEFORE UPDATE ON %1$I.%2$I
      FOR EACH ROW EXECUTE FUNCTION data_warehouse_v2.raise_append_only_violation();
    CREATE TRIGGER %2$I_no_delete
      BEFORE DELETE ON %1$I.%2$I
      FOR EACH ROW EXECUTE FUNCTION data_warehouse_v2.raise_append_only_violation();
  $sql$, schema_name, tbl);
END $proc$;

COMMENT ON PROCEDURE data_warehouse_v2.enable_append_only_protection(text) IS
  'Adds BEFORE UPDATE / DELETE triggers that block mutations on the given '
  'table. Apply once a table is settled. Disabling requires an explicit '
  'DROP TRIGGER in a follow-up migration.';

COMMIT;

-- Not applied to any table yet. Adopters call manually, e.g.:
--   CALL data_warehouse_v2.enable_append_only_protection('raw_zaim__money');
