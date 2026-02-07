-- 003_create_fitbit_raw_tables.sql
-- =============================================================================
-- Fitbit raw tables in data_warehouse schema
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fitbit: Sleep (API v1.2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__sleep (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1.2'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__sleep_synced_at
    ON data_warehouse.raw_fitbit__sleep (synced_at);
CREATE INDEX IF NOT EXISTS idx_raw_fitbit__sleep_data
    ON data_warehouse.raw_fitbit__sleep USING gin (data);

-- ---------------------------------------------------------------------------
-- Fitbit: Activity (API v1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__activity_synced_at
    ON data_warehouse.raw_fitbit__activity (synced_at);
CREATE INDEX IF NOT EXISTS idx_raw_fitbit__activity_data
    ON data_warehouse.raw_fitbit__activity USING gin (data);

-- ---------------------------------------------------------------------------
-- Fitbit: Heart Rate (API v1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__heart_rate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__heart_rate_synced_at
    ON data_warehouse.raw_fitbit__heart_rate (synced_at);

-- ---------------------------------------------------------------------------
-- Fitbit: HRV (API v1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__hrv (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__hrv_synced_at
    ON data_warehouse.raw_fitbit__hrv (synced_at);

-- ---------------------------------------------------------------------------
-- Fitbit: SpO2 (API v1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__spo2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__spo2_synced_at
    ON data_warehouse.raw_fitbit__spo2 (synced_at);

-- ---------------------------------------------------------------------------
-- Fitbit: Breathing Rate (API v1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__breathing_rate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__breathing_rate_synced_at
    ON data_warehouse.raw_fitbit__breathing_rate (synced_at);

-- ---------------------------------------------------------------------------
-- Fitbit: Cardio Score / VO2 Max (API v1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__cardio_score (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__cardio_score_synced_at
    ON data_warehouse.raw_fitbit__cardio_score (synced_at);

-- ---------------------------------------------------------------------------
-- Fitbit: Temperature Skin (API v1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_warehouse.raw_fitbit__temperature_skin (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_fitbit__temperature_skin_synced_at
    ON data_warehouse.raw_fitbit__temperature_skin (synced_at);
