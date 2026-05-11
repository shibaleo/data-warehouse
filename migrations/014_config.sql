-- 014_config.sql
-- =============================================================================
-- Project-wide config table + accessor function.
--
-- The schema name "data_warehouse_v2" appears in many migration / function
-- bodies. To let boilerplate consumers re-target the same code at a different
-- schema (or change other knobs like the content_hash algorithm) without
-- find-replace, we centralise config here.
--
-- Lives in `public` with the `dwh_` prefix so it's reachable from any
-- function without qualification and won't collide with unrelated tools.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.dwh_config (
    key        text        PRIMARY KEY,
    value      text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dwh_config IS
  'Project-wide configuration for the dwh boilerplate. Read via dwh_cfg(key).';

-- Accessor with hard-typed return. STABLE so PG can cache per-statement.
CREATE OR REPLACE FUNCTION public.dwh_cfg(k text)
RETURNS text
LANGUAGE SQL STABLE AS $$
  SELECT value FROM public.dwh_config WHERE key = k
$$;

COMMENT ON FUNCTION public.dwh_cfg(text) IS
  'Read a value from public.dwh_config by key. Used by raw_at and the CRUD '
  'factory procedures so the schema name is not hardcoded.';

-- Seed initial values. Use ON CONFLICT so re-running is idempotent.
INSERT INTO public.dwh_config (key, value) VALUES
    ('schema_name',    'data_warehouse_v2'),
    ('hash_algorithm', 'md5')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Update raw_at to read schema from config.
-- Functionally identical to migration 012's version; just looks up the
-- schema via dwh_cfg('schema_name') instead of hardcoding 'data_warehouse_v2'.
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
     FROM %I.%I
     WHERE created_at <= $1
     ORDER BY source_id, revision DESC',
    public.dwh_cfg('schema_name'),
    tbl
  ) USING t;
END $$;

COMMIT;
