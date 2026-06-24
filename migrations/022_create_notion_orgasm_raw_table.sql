-- 022_create_notion_orgasm_raw_table.sql
-- =============================================================================
-- Notion TB__ORGASM raw table. Same append-only / uni-temporal shape as 021.
--
-- Schema choice: the Notion DB has a `date` Title column (free-text ISO
-- string typed by the user). We deliberately ignore it in stg and use
-- Notion's built-in `created_time` instead — created_time is
-- server-generated, never breaks, and in this DB's "log immediately when it
-- happens" usage pattern it tracks the real event time to the minute.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  entities text[] := ARRAY[
    'orgasm'
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
