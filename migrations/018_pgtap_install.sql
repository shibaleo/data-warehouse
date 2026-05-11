-- 018_pgtap_install.sql
-- =============================================================================
-- Install pgtap and create a tests/ schema where per-feature test scripts
-- can plug in. Actual test files live alongside this migration in
-- migrations/tests/*.sql and are run via:
--
--   pg_prove -h <host> -U <user> -d <db> migrations/tests/*.sql
--
-- Tests are NOT part of `dbt run`; they're a separate invariant check on
-- the PG structure itself. CI / on-demand only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

COMMIT;
