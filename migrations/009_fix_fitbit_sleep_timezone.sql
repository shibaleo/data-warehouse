-- 009_fix_fitbit_sleep_timezone.sql
-- =============================================================================
-- Backfill timezone offset onto Fitbit sleep timestamps that were stored naive.
--
-- Fitbit returns datetimes reflecting the account timezone setting without
-- an explicit offset (e.g. "2026-05-05T23:32:00.000"). Stored as-is, the
-- ::timestamptz cast misinterprets them as UTC and shifts every reading by
-- 9 hours. The connector now appends +09:00 on write (CLAUDE.md → "時間
-- データの必須ルール"), and this migration corrects rows that landed before
-- that fix.
--
-- Append-only consideration: the canonical way to record a correction in
-- this schema is a new revision per source_id. We chose in-place UPDATE on
-- existing revisions instead because:
--
--   1. The corrected and original strings denote the same moment in time —
--      there is no semantic event being recorded, just a representation
--      bug being patched.
--   2. Spawning revision=2 on every existing sleep row would double the
--      table size and pollute future "what changed" queries.
--   3. Treating this as part of the same migration that introduced the
--      schema (007/008) keeps the historical integrity argument simple.
--
-- content_hash is recomputed because the data column is now different bytes;
-- otherwise the next sync would diff-mismatch and append a duplicate.
-- =============================================================================

BEGIN;

-- Fix start_time and end_time, plus dateTime in levels.data[]
-- Each UPDATE handles one field; nested array uses a CTE-built replacement.
UPDATE data_warehouse_v2.raw_fitbit__sleep s
SET data = (
  SELECT jsonb_set(
    jsonb_set(
      CASE
        WHEN s.data->'levels'->'data' IS NOT NULL THEN
          jsonb_set(
            s.data,
            '{levels,data}',
            (
              SELECT jsonb_agg(
                CASE
                  WHEN elem->>'dateTime' IS NOT NULL
                       AND elem->>'dateTime' !~ '(?:Z|[+\-]\d{2}:\d{2})$'
                  THEN jsonb_set(elem, '{dateTime}', to_jsonb((elem->>'dateTime') || '+09:00'))
                  ELSE elem
                END
              )
              FROM jsonb_array_elements(s.data->'levels'->'data') elem
            )
          )
        ELSE s.data
      END,
      '{start_time}',
      to_jsonb(
        CASE
          WHEN s.data->>'start_time' !~ '(?:Z|[+\-]\d{2}:\d{2})$'
          THEN (s.data->>'start_time') || '+09:00'
          ELSE s.data->>'start_time'
        END
      )
    ),
    '{end_time}',
    to_jsonb(
      CASE
        WHEN s.data->>'end_time' !~ '(?:Z|[+\-]\d{2}:\d{2})$'
        THEN (s.data->>'end_time') || '+09:00'
        ELSE s.data->>'end_time'
      END
    )
  )
)
WHERE s.data->>'start_time' !~ '(?:Z|[+\-]\d{2}:\d{2})$'
   OR s.data->>'end_time' !~ '(?:Z|[+\-]\d{2}:\d{2})$';

-- Recompute content_hash so next sync sees this as the canonical state.
UPDATE data_warehouse_v2.raw_fitbit__sleep
SET content_hash = md5((data - 'at')::text);

-- Also fix shortData inside levels (may be NULL on some rows; handle both).
UPDATE data_warehouse_v2.raw_fitbit__sleep s
SET data = jsonb_set(
  s.data,
  '{levels,shortData}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem->>'dateTime' IS NOT NULL
             AND elem->>'dateTime' !~ '(?:Z|[+\-]\d{2}:\d{2})$'
        THEN jsonb_set(elem, '{dateTime}', to_jsonb((elem->>'dateTime') || '+09:00'))
        ELSE elem
      END
    )
    FROM jsonb_array_elements(s.data->'levels'->'shortData') elem
  )
)
WHERE jsonb_typeof(s.data->'levels'->'shortData') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(s.data->'levels'->'shortData') elem
    WHERE elem->>'dateTime' !~ '(?:Z|[+\-]\d{2}:\d{2})$'
  );

UPDATE data_warehouse_v2.raw_fitbit__sleep
SET content_hash = md5((data - 'at')::text);

COMMIT;

-- Sanity check (run after COMMIT):
--   SELECT data->>'start_time', (data->>'start_time')::timestamptz
--   FROM data_warehouse_v2.raw_fitbit__sleep_current
--   ORDER BY (data->>'date')::date DESC LIMIT 3;
-- start_time should now end with +09:00 and the timestamptz should equal
-- the wall-clock JST time (i.e. UTC = wall - 9h).
