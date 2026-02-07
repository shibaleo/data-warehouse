-- Tanita Health Planet raw tables
-- Body composition (weight, body fat) and blood pressure (systolic, diastolic, pulse)

CREATE TABLE IF NOT EXISTS data_warehouse.raw_tanita_health_planet__body_composition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_tanita_hp_bc_synced_at
    ON data_warehouse.raw_tanita_health_planet__body_composition (synced_at);

CREATE TABLE IF NOT EXISTS data_warehouse.raw_tanita_health_planet__blood_pressure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_raw_tanita_hp_bp_synced_at
    ON data_warehouse.raw_tanita_health_planet__blood_pressure (synced_at);
