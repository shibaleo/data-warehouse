-- 011_strip_volatile_master_fields.sql
-- =============================================================================
-- Strip aggregate/audit fields from Toggl master raw rows that change without
-- any user-meaningful edit, and consolidate the revision=2 noise rows that
-- the un-stripped resync just produced.
--
-- Background: a fresh masters sync against the v2 schema produced revision=2
-- on every project (33/33), workspace (1/1), and me (1/1) — not because the
-- user touched anything, but because Toggl's API returns:
--
--   - projects: actual_hours / actual_seconds (per-project time totals,
--     bumped by every new time entry) and total_count (workspace-level
--     project count, bumped when ANY new project is added)
--   - workspaces: last_modified (daily heartbeat-ish)
--   - me: authorization_updated_at (bumped on every API auth)
--
-- The connector now strips these fields before storage. This migration:
--   1. Strips them from existing rows (revision=1 AND any revision=2 noise)
--   2. Recomputes content_hash on every row
--   3. Drops revision=2 rows whose content_hash now matches their
--      revision=1 sibling — they are pure noise and would have been no-ops
--      under the new logic
-- =============================================================================

BEGIN;

-- 1) Strip volatile fields from projects ------------------------------------
UPDATE data_warehouse_v2.raw_toggl_track__projects
SET data = data - 'actual_hours' - 'actual_seconds' - 'total_count';
UPDATE data_warehouse_v2.raw_toggl_track__projects
SET content_hash = md5((data - 'at')::text);

-- 2) Strip volatile fields from workspaces ----------------------------------
UPDATE data_warehouse_v2.raw_toggl_track__workspaces
SET data = data - 'last_modified';
UPDATE data_warehouse_v2.raw_toggl_track__workspaces
SET content_hash = md5((data - 'at')::text);

-- 3) Strip volatile fields from me ------------------------------------------
UPDATE data_warehouse_v2.raw_toggl_track__me
SET data = data - 'authorization_updated_at';
UPDATE data_warehouse_v2.raw_toggl_track__me
SET content_hash = md5((data - 'at')::text);

-- 4) Drop revision>1 rows whose content_hash now matches their predecessor
--    (= the only difference was a stripped volatile field). For each
--    affected table.
DELETE FROM data_warehouse_v2.raw_toggl_track__projects p
WHERE p.revision > 1
  AND EXISTS (
    SELECT 1 FROM data_warehouse_v2.raw_toggl_track__projects p2
    WHERE p2.source_id = p.source_id
      AND p2.revision = p.revision - 1
      AND p2.content_hash = p.content_hash
      AND p2.deleted = p.deleted
  );

DELETE FROM data_warehouse_v2.raw_toggl_track__workspaces w
WHERE w.revision > 1
  AND EXISTS (
    SELECT 1 FROM data_warehouse_v2.raw_toggl_track__workspaces w2
    WHERE w2.source_id = w.source_id
      AND w2.revision = w.revision - 1
      AND w2.content_hash = w.content_hash
      AND w2.deleted = w.deleted
  );

DELETE FROM data_warehouse_v2.raw_toggl_track__me m
WHERE m.revision > 1
  AND EXISTS (
    SELECT 1 FROM data_warehouse_v2.raw_toggl_track__me m2
    WHERE m2.source_id = m.source_id
      AND m2.revision = m.revision - 1
      AND m2.content_hash = m.content_hash
      AND m2.deleted = m.deleted
  );

COMMIT;
