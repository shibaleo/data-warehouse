-- 023_create_notion_running_raw_table.sql
-- =============================================================================
-- Notion TB__RUNNING raw table. Same append-only / uni-temporal shape as 021/022.
--
-- TB_RUNNING properties (Notion side):
--   datetime     title       ISO 8601 with +09:00 offset (e.g. "2026-06-24T18:14:00+09:00")
--   distance_km  number
--   duration_min number
--   rpe          number      perceived exertion 1-10
--   type         select      walk | jog | run
--   surface      select      road | treadmill | trail | track | indoor
--   memo         rich_text
--
-- The `datetime` title is authored by hand and is the source of truth for
-- *when* the run happened (created_time would lag if logged hours later).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  entities text[] := ARRAY[
    'running'
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
