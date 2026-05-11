-- 015_create_raw_functions.sql
-- =============================================================================
-- Procedure that mints per-table CRUD helper functions for raw tables:
--   <tbl>_tombstone(source_id)  -- append deleted=true revision (soft delete)
--   <tbl>_purge(source_id)      -- append purged=true revision (final marker)
--
-- Both helpers carry forward the latest data + content_hash into the new
-- revision (we mark lifecycle, not content). Append-only invariant intact.
-- Purge is logical only: no physical deletion, no content alteration. The
-- partial unique index on (source_id) WHERE purged=true enforces "once".
-- =============================================================================

BEGIN;

CREATE OR REPLACE PROCEDURE data_warehouse_v2.create_raw_functions(tbl text)
LANGUAGE plpgsql AS $proc$
DECLARE
  schema_name text := public.dwh_cfg('schema_name');
BEGIN
  -- The inner SQL is wrapped in format(); any literal % must be doubled.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.%2$I_tombstone(target_source_id text)
    RETURNS void LANGUAGE plpgsql AS $func$
    DECLARE
      already_deleted boolean;
    BEGIN
      SELECT deleted INTO already_deleted
      FROM %1$I.%2$I
      WHERE source_id = target_source_id
      ORDER BY revision DESC LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'tombstone: source_id %% not found in %%.%%',
          target_source_id, %1$L, %2$L;
      END IF;
      IF already_deleted THEN
        RAISE NOTICE 'tombstone: %% already deleted', target_source_id;
        RETURN;
      END IF;

      INSERT INTO %1$I.%2$I
        (source_id, revision, data, content_hash, deleted, purged, api_version)
      SELECT source_id, revision + 1, data, content_hash, true, false, api_version
      FROM %1$I.%2$I
      WHERE source_id = target_source_id
      ORDER BY revision DESC LIMIT 1;
    END $func$;
  $sql$, schema_name, tbl);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.%2$I_purge(target_source_id text)
    RETURNS void LANGUAGE plpgsql AS $func$
    DECLARE
      already_purged boolean;
    BEGIN
      SELECT purged INTO already_purged
      FROM %1$I.%2$I
      WHERE source_id = target_source_id
      ORDER BY revision DESC LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'purge: source_id %% not found in %%.%%',
          target_source_id, %1$L, %2$L;
      END IF;
      IF already_purged THEN
        RAISE NOTICE 'purge: %% already purged', target_source_id;
        RETURN;
      END IF;

      INSERT INTO %1$I.%2$I
        (source_id, revision, data, content_hash, deleted, purged, api_version)
      SELECT source_id, revision + 1, data, content_hash, true, true, api_version
      FROM %1$I.%2$I
      WHERE source_id = target_source_id
      ORDER BY revision DESC LIMIT 1;
    END $func$;
  $sql$, schema_name, tbl);
END $proc$;

COMMENT ON PROCEDURE data_warehouse_v2.create_raw_functions(text) IS
  'Mints <tbl>_tombstone(source_id) and <tbl>_purge(source_id) helper '
  'functions for the given raw table. Call once after CREATE TABLE.';

-- ---------------------------------------------------------------------------
-- Apply to every existing raw table in the configured schema.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  raw_table text;
BEGIN
  FOR raw_table IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = public.dwh_cfg('schema_name')
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'raw\_%' ESCAPE '\'
    ORDER BY table_name
  LOOP
    CALL data_warehouse_v2.create_raw_functions(raw_table);
  END LOOP;
END $$;

COMMIT;
