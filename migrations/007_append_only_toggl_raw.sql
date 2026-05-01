-- 007_append_only_toggl_raw.sql
-- =============================================================================
-- Migrate Toggl raw layer from UPSERT-based to append-only / uni-temporal.
--
-- New schema: data_warehouse_v2
--   - One new table per Toggl raw, plus a *_current view per table.
--   - PRIMARY KEY (source_id, revision) — every state change is a new row.
--   - content_hash always computed in PostgreSQL via md5((data - 'at')::text)
--     so backfill and runtime sync produce identical hashes (no JS/PG drift).
--   - Old data_warehouse.raw_toggl_track__* tables are left untouched as
--     the rollback path; they will be DROPped only after smoke test passes.
--
-- See docs/001_append_only_redesign.md for the design rationale.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS data_warehouse_v2;

-- ---------------------------------------------------------------------------
-- helper: per-table DDL is identical except for the table name, so do it
-- in the same shape five times. Using explicit CREATE statements (not a
-- DO block) keeps the migration grep-able and reviewable per table.
-- ---------------------------------------------------------------------------

-- ===== raw_toggl_track__time_entries (Track API v9) =========================

CREATE TABLE data_warehouse_v2.raw_toggl_track__time_entries (
    source_id    TEXT        NOT NULL,
    revision     INT         NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    data         JSONB       NOT NULL,
    content_hash TEXT        NOT NULL,
    deleted      BOOLEAN     NOT NULL DEFAULT false,
    purged       BOOLEAN     NOT NULL DEFAULT false,
    api_version  TEXT,
    PRIMARY KEY (source_id, revision)
);

CREATE UNIQUE INDEX raw_toggl_track__time_entries_purge_unique
    ON data_warehouse_v2.raw_toggl_track__time_entries (source_id)
    WHERE purged = true;

CREATE INDEX raw_toggl_track__time_entries_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__time_entries (source_id, revision DESC);

INSERT INTO data_warehouse_v2.raw_toggl_track__time_entries
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT
    source_id, 1, synced_at, data,
    md5((data - 'at')::text),
    false, false, api_version
FROM data_warehouse.raw_toggl_track__time_entries;

CREATE VIEW data_warehouse_v2.raw_toggl_track__time_entries_current AS
SELECT * FROM (
    SELECT DISTINCT ON (source_id) *
    FROM data_warehouse_v2.raw_toggl_track__time_entries
    ORDER BY source_id, revision DESC
) t
WHERE deleted = false AND purged = false;

-- ===== raw_toggl_track__time_entries_report (Reports API v3) ================

CREATE TABLE data_warehouse_v2.raw_toggl_track__time_entries_report (
    source_id    TEXT        NOT NULL,
    revision     INT         NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    data         JSONB       NOT NULL,
    content_hash TEXT        NOT NULL,
    deleted      BOOLEAN     NOT NULL DEFAULT false,
    purged       BOOLEAN     NOT NULL DEFAULT false,
    api_version  TEXT,
    PRIMARY KEY (source_id, revision)
);

CREATE UNIQUE INDEX raw_toggl_track__time_entries_report_purge_unique
    ON data_warehouse_v2.raw_toggl_track__time_entries_report (source_id)
    WHERE purged = true;

CREATE INDEX raw_toggl_track__time_entries_report_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__time_entries_report (source_id, revision DESC);

INSERT INTO data_warehouse_v2.raw_toggl_track__time_entries_report
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT
    source_id, 1, synced_at, data,
    md5((data - 'at')::text),
    false, false, api_version
FROM data_warehouse.raw_toggl_track__time_entries_report;

CREATE VIEW data_warehouse_v2.raw_toggl_track__time_entries_report_current AS
SELECT * FROM (
    SELECT DISTINCT ON (source_id) *
    FROM data_warehouse_v2.raw_toggl_track__time_entries_report
    ORDER BY source_id, revision DESC
) t
WHERE deleted = false AND purged = false;

-- ===== raw_toggl_track__projects ============================================

CREATE TABLE data_warehouse_v2.raw_toggl_track__projects (
    source_id    TEXT        NOT NULL,
    revision     INT         NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    data         JSONB       NOT NULL,
    content_hash TEXT        NOT NULL,
    deleted      BOOLEAN     NOT NULL DEFAULT false,
    purged       BOOLEAN     NOT NULL DEFAULT false,
    api_version  TEXT,
    PRIMARY KEY (source_id, revision)
);

CREATE UNIQUE INDEX raw_toggl_track__projects_purge_unique
    ON data_warehouse_v2.raw_toggl_track__projects (source_id)
    WHERE purged = true;

CREATE INDEX raw_toggl_track__projects_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__projects (source_id, revision DESC);

INSERT INTO data_warehouse_v2.raw_toggl_track__projects
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT
    source_id, 1, synced_at, data,
    md5((data - 'at')::text),
    false, false, api_version
FROM data_warehouse.raw_toggl_track__projects;

CREATE VIEW data_warehouse_v2.raw_toggl_track__projects_current AS
SELECT * FROM (
    SELECT DISTINCT ON (source_id) *
    FROM data_warehouse_v2.raw_toggl_track__projects
    ORDER BY source_id, revision DESC
) t
WHERE deleted = false AND purged = false;

-- ===== raw_toggl_track__clients =============================================

CREATE TABLE data_warehouse_v2.raw_toggl_track__clients (
    source_id    TEXT        NOT NULL,
    revision     INT         NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    data         JSONB       NOT NULL,
    content_hash TEXT        NOT NULL,
    deleted      BOOLEAN     NOT NULL DEFAULT false,
    purged       BOOLEAN     NOT NULL DEFAULT false,
    api_version  TEXT,
    PRIMARY KEY (source_id, revision)
);

CREATE UNIQUE INDEX raw_toggl_track__clients_purge_unique
    ON data_warehouse_v2.raw_toggl_track__clients (source_id)
    WHERE purged = true;

CREATE INDEX raw_toggl_track__clients_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__clients (source_id, revision DESC);

INSERT INTO data_warehouse_v2.raw_toggl_track__clients
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT
    source_id, 1, synced_at, data,
    md5((data - 'at')::text),
    false, false, api_version
FROM data_warehouse.raw_toggl_track__clients;

CREATE VIEW data_warehouse_v2.raw_toggl_track__clients_current AS
SELECT * FROM (
    SELECT DISTINCT ON (source_id) *
    FROM data_warehouse_v2.raw_toggl_track__clients
    ORDER BY source_id, revision DESC
) t
WHERE deleted = false AND purged = false;

-- ===== raw_toggl_track__tags ================================================

CREATE TABLE data_warehouse_v2.raw_toggl_track__tags (
    source_id    TEXT        NOT NULL,
    revision     INT         NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    data         JSONB       NOT NULL,
    content_hash TEXT        NOT NULL,
    deleted      BOOLEAN     NOT NULL DEFAULT false,
    purged       BOOLEAN     NOT NULL DEFAULT false,
    api_version  TEXT,
    PRIMARY KEY (source_id, revision)
);

CREATE UNIQUE INDEX raw_toggl_track__tags_purge_unique
    ON data_warehouse_v2.raw_toggl_track__tags (source_id)
    WHERE purged = true;

CREATE INDEX raw_toggl_track__tags_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__tags (source_id, revision DESC);

INSERT INTO data_warehouse_v2.raw_toggl_track__tags
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT
    source_id, 1, synced_at, data,
    md5((data - 'at')::text),
    false, false, api_version
FROM data_warehouse.raw_toggl_track__tags;

CREATE VIEW data_warehouse_v2.raw_toggl_track__tags_current AS
SELECT * FROM (
    SELECT DISTINCT ON (source_id) *
    FROM data_warehouse_v2.raw_toggl_track__tags
    ORDER BY source_id, revision DESC
) t
WHERE deleted = false AND purged = false;

-- ===== raw_toggl_track__me / __workspaces / __users / __groups =============
-- Doc lists these as "deferrable", but the connector calls appendRaw on all
-- raw tables and the helper assumes RAW_SCHEMA = data_warehouse_v2 across
-- the board. Migrate them now in the same shape so the connector can stay
-- single-schema; they just won't see much churn.

CREATE TABLE data_warehouse_v2.raw_toggl_track__me (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_toggl_track__me_purge_unique
    ON data_warehouse_v2.raw_toggl_track__me (source_id) WHERE purged = true;
CREATE INDEX raw_toggl_track__me_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__me (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_toggl_track__me
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_toggl_track__me;
CREATE VIEW data_warehouse_v2.raw_toggl_track__me_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_toggl_track__me ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_toggl_track__workspaces (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_toggl_track__workspaces_purge_unique
    ON data_warehouse_v2.raw_toggl_track__workspaces (source_id) WHERE purged = true;
CREATE INDEX raw_toggl_track__workspaces_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__workspaces (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_toggl_track__workspaces
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_toggl_track__workspaces;
CREATE VIEW data_warehouse_v2.raw_toggl_track__workspaces_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_toggl_track__workspaces ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_toggl_track__users (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_toggl_track__users_purge_unique
    ON data_warehouse_v2.raw_toggl_track__users (source_id) WHERE purged = true;
CREATE INDEX raw_toggl_track__users_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__users (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_toggl_track__users
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_toggl_track__users;
CREATE VIEW data_warehouse_v2.raw_toggl_track__users_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_toggl_track__users ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_toggl_track__groups (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_toggl_track__groups_purge_unique
    ON data_warehouse_v2.raw_toggl_track__groups (source_id) WHERE purged = true;
CREATE INDEX raw_toggl_track__groups_source_revision_desc
    ON data_warehouse_v2.raw_toggl_track__groups (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_toggl_track__groups
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_toggl_track__groups;
CREATE VIEW data_warehouse_v2.raw_toggl_track__groups_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_toggl_track__groups ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

COMMIT;

-- =============================================================================
-- Sanity-check queries (run after COMMIT, comparing to old tables):
--
-- SELECT 'time_entries'        AS t, count(*) AS old, (SELECT count(*) FROM data_warehouse_v2.raw_toggl_track__time_entries_current)         AS new_current FROM data_warehouse.raw_toggl_track__time_entries
-- UNION ALL
-- SELECT 'time_entries_report' AS t, count(*) AS old, (SELECT count(*) FROM data_warehouse_v2.raw_toggl_track__time_entries_report_current)  AS new_current FROM data_warehouse.raw_toggl_track__time_entries_report
-- UNION ALL
-- SELECT 'projects',                  count(*),       (SELECT count(*) FROM data_warehouse_v2.raw_toggl_track__projects_current)             FROM data_warehouse.raw_toggl_track__projects
-- UNION ALL
-- SELECT 'clients',                   count(*),       (SELECT count(*) FROM data_warehouse_v2.raw_toggl_track__clients_current)              FROM data_warehouse.raw_toggl_track__clients
-- UNION ALL
-- SELECT 'tags',                      count(*),       (SELECT count(*) FROM data_warehouse_v2.raw_toggl_track__tags_current)                 FROM data_warehouse.raw_toggl_track__tags;
--
-- Each row's `old` and `new_current` MUST match.
-- =============================================================================
