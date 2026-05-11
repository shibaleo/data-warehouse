-- 016_create_dim_functions.sql
-- =============================================================================
-- Replaces 013's create_dim_at_function with the expanded create_dim_functions
-- procedure that mints all three helpers for a dim table:
--
--   <tbl>_at(biz_t, tx_t)            -- bitemporal as-of-T read
--   <tbl>_tombstone(id, valid_from)  -- soft-delete (append deleted=true)
--   <tbl>_purge(id)                  -- final logical purge (append purged=true)
--
-- The tombstone / purge helpers use jsonb_populate_record to carry forward
-- the latest row's typed content columns without enumerating them — they
-- work for any dim table that follows the Pattern 2 shape.
-- =============================================================================

BEGIN;

DROP PROCEDURE IF EXISTS data_warehouse_v2.create_dim_at_function(text);

CREATE OR REPLACE PROCEDURE data_warehouse_v2.create_dim_functions(tbl text)
LANGUAGE plpgsql AS $proc$
DECLARE
  schema_name text := public.dwh_cfg('schema_name');
BEGIN
  -- ---- <tbl>_at(biz_t, tx_t) -----------------------------------------------
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.%2$I_at(
      biz_t timestamptz DEFAULT now(),
      tx_t  timestamptz DEFAULT now()
    )
    RETURNS SETOF %1$I.%2$I
    LANGUAGE SQL STABLE AS $func$
      SELECT DISTINCT ON (id) *
      FROM %1$I.%2$I
      WHERE created_at <= tx_t AND valid_from <= biz_t
      ORDER BY id, valid_from DESC, revision DESC;
    $func$;
  $sql$, schema_name, tbl);

  -- ---- <tbl>_tombstone(id, valid_from) -------------------------------------
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.%2$I_tombstone(
      target_id uuid,
      valid_from_t timestamptz DEFAULT now()
    )
    RETURNS void LANGUAGE plpgsql AS $func$
    DECLARE
      next_rev int;
      already_deleted boolean;
    BEGIN
      SELECT revision + 1, deleted
        INTO next_rev, already_deleted
      FROM %1$I.%2$I
      WHERE id = target_id
      ORDER BY revision DESC LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'tombstone: id %% not found in %%.%%',
          target_id, %1$L, %2$L;
      END IF;
      IF already_deleted THEN
        RAISE NOTICE 'tombstone: id %% already deleted', target_id;
        RETURN;
      END IF;

      INSERT INTO %1$I.%2$I
      SELECT (jsonb_populate_record(
        NULL::%1$I.%2$I,
        to_jsonb(prev) || jsonb_build_object(
          'revision',   next_rev,
          'created_at', now(),
          'valid_from', valid_from_t,
          'deleted',    true,
          'purged',     false
        )
      )).*
      FROM %1$I.%2$I prev
      WHERE prev.id = target_id
      ORDER BY prev.revision DESC LIMIT 1;
    END $func$;
  $sql$, schema_name, tbl);

  -- ---- <tbl>_purge(id) -----------------------------------------------------
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.%2$I_purge(target_id uuid)
    RETURNS void LANGUAGE plpgsql AS $func$
    DECLARE
      next_rev int;
      already_purged boolean;
    BEGIN
      SELECT revision + 1, purged
        INTO next_rev, already_purged
      FROM %1$I.%2$I
      WHERE id = target_id
      ORDER BY revision DESC LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'purge: id %% not found in %%.%%',
          target_id, %1$L, %2$L;
      END IF;
      IF already_purged THEN
        RAISE NOTICE 'purge: id %% already purged', target_id;
        RETURN;
      END IF;

      INSERT INTO %1$I.%2$I
      SELECT (jsonb_populate_record(
        NULL::%1$I.%2$I,
        to_jsonb(prev) || jsonb_build_object(
          'revision',   next_rev,
          'created_at', now(),
          'valid_from', now(),
          'deleted',    true,
          'purged',     true
        )
      )).*
      FROM %1$I.%2$I prev
      WHERE prev.id = target_id
      ORDER BY prev.revision DESC LIMIT 1;
    END $func$;
  $sql$, schema_name, tbl);
END $proc$;

COMMENT ON PROCEDURE data_warehouse_v2.create_dim_functions(text) IS
  'Mints <tbl>_at(biz_t, tx_t), <tbl>_tombstone(id, valid_from), and '
  '<tbl>_purge(id) helper functions for the given Pattern 2 dim table. '
  'Call once after CREATE TABLE.';

CALL data_warehouse_v2.create_dim_functions('example_dim');

COMMIT;
