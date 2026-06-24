-- 021_create_notion_strength_raw_tables.sql
-- =============================================================================
-- Notion strength-log raw table. Sourced from a Notion database (TB__STRENGTH)
-- via the Notion API v2022-06-28. Append-only / uni-temporal, identical shape
-- to other data_warehouse_v2.raw_* tables (see 019).
--
-- TZ note: Notion returns `created_time` / `last_edited_time` with a `Z`
-- suffix (UTC), and the `date` property as a naive calendar date string
-- ("YYYY-MM-DD") with no time component. Both satisfy the CLAUDE.md offset
-- rule without needing withOffset() backfill in the connector.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  entities text[] := ARRAY[
    'strength'
  ];
  entity text;
  tbl    text;
BEGIN
  FOREACH entity IN ARRAY entities LOOP
    tbl := 'raw_notion__' || entity;

    EXECUTE format($f$
      CREATE TABLE data_warehouse_v2.%1$I (
        source_id    TEXT        NOT NULL,
        revision     INT         NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        data         JSONB       NOT NULL,
        content_hash TEXT        NOT NULL,
        deleted      BOOLEAN     NOT NULL DEFAULT false,
        purged       BOOLEAN     NOT NULL DEFAULT false,
        api_version  TEXT        DEFAULT '2022-06-28',
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
