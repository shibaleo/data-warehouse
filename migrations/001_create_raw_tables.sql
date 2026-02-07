-- 001_create_raw_tables.sql
-- =============================================================================
-- Neon PostgreSQL: data_warehouse schema with raw_ prefixed tables
-- No RLS (personal DWH)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS data_warehouse;

-- ---------------------------------------------------------------------------
-- Toggl Track: Time Entries (Track API v9 - daily sync)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

CREATE INDEX IF NOT EXISTS idx_raw_toggl_track__time_entries_synced_at
    ON data_warehouse.raw_toggl_track__time_entries (synced_at);
CREATE INDEX IF NOT EXISTS idx_raw_toggl_track__time_entries_data
    ON data_warehouse.raw_toggl_track__time_entries USING gin (data);

-- ---------------------------------------------------------------------------
-- Toggl Track: Time Entries Report (Reports API v3 - historical full data)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__time_entries_report (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v3'
);

CREATE INDEX IF NOT EXISTS idx_raw_toggl_track__time_entries_report_synced_at
    ON data_warehouse.raw_toggl_track__time_entries_report (synced_at);
CREATE INDEX IF NOT EXISTS idx_raw_toggl_track__time_entries_report_data
    ON data_warehouse.raw_toggl_track__time_entries_report USING gin (data);

-- ---------------------------------------------------------------------------
-- Toggl Track: Projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

CREATE INDEX IF NOT EXISTS idx_raw_toggl_track__projects_synced_at
    ON data_warehouse.raw_toggl_track__projects (synced_at);

-- ---------------------------------------------------------------------------
-- Toggl Track: Clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

CREATE INDEX IF NOT EXISTS idx_raw_toggl_track__clients_synced_at
    ON data_warehouse.raw_toggl_track__clients (synced_at);

-- ---------------------------------------------------------------------------
-- Toggl Track: Tags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

CREATE INDEX IF NOT EXISTS idx_raw_toggl_track__tags_synced_at
    ON data_warehouse.raw_toggl_track__tags (synced_at);

-- ---------------------------------------------------------------------------
-- Toggl Track: Me (current user profile)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__me (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

-- ---------------------------------------------------------------------------
-- Toggl Track: Workspaces
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

-- ---------------------------------------------------------------------------
-- Toggl Track: Users (workspace members)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);

-- ---------------------------------------------------------------------------
-- Toggl Track: Groups (workspace groups)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_toggl_track__groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v9'
);
