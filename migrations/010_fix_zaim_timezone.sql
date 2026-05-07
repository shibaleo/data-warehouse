-- 010_fix_zaim_timezone.sql
-- =============================================================================
-- Backfill +09:00 onto Zaim datetime fields stored naive.
--
-- Affected fields (all JST naive, "YYYY-MM-DD HH:MM:SS"):
--   raw_zaim__money.data->>'created'
--   raw_zaim__category.data->>'modified'
--   raw_zaim__genre.data->>'modified'
--   raw_zaim__account.data->>'modified'
--
-- See migrations/009_fix_fitbit_sleep_timezone.sql for the rationale on
-- in-place UPDATE vs new revision (representation patch, not semantic
-- event). content_hash recomputed to keep next sync diff-clean.
--
-- The space separator that Zaim uses ("2025-04-01 22:38:44") is a valid
-- ISO 8601 variant; appending +09:00 yields "2025-04-01 22:38:44+09:00",
-- which PostgreSQL ::timestamptz parses correctly.
-- =============================================================================

BEGIN;

UPDATE data_warehouse_v2.raw_zaim__money
SET data = jsonb_set(
  data,
  '{created}',
  to_jsonb((data->>'created') || '+09:00')
)
WHERE data->>'created' IS NOT NULL
  AND data->>'created' !~ '(?:Z|[+\-]\d{2}:\d{2})$';

UPDATE data_warehouse_v2.raw_zaim__category
SET data = jsonb_set(
  data,
  '{modified}',
  to_jsonb((data->>'modified') || '+09:00')
)
WHERE data->>'modified' IS NOT NULL
  AND data->>'modified' !~ '(?:Z|[+\-]\d{2}:\d{2})$';

UPDATE data_warehouse_v2.raw_zaim__genre
SET data = jsonb_set(
  data,
  '{modified}',
  to_jsonb((data->>'modified') || '+09:00')
)
WHERE data->>'modified' IS NOT NULL
  AND data->>'modified' !~ '(?:Z|[+\-]\d{2}:\d{2})$';

UPDATE data_warehouse_v2.raw_zaim__account
SET data = jsonb_set(
  data,
  '{modified}',
  to_jsonb((data->>'modified') || '+09:00')
)
WHERE data->>'modified' IS NOT NULL
  AND data->>'modified' !~ '(?:Z|[+\-]\d{2}:\d{2})$';

-- Recompute content_hash on every rewritten row.
UPDATE data_warehouse_v2.raw_zaim__money    SET content_hash = md5((data - 'at')::text);
UPDATE data_warehouse_v2.raw_zaim__category SET content_hash = md5((data - 'at')::text);
UPDATE data_warehouse_v2.raw_zaim__genre    SET content_hash = md5((data - 'at')::text);
UPDATE data_warehouse_v2.raw_zaim__account  SET content_hash = md5((data - 'at')::text);

COMMIT;
