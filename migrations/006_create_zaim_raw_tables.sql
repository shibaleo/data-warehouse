-- Zaim raw tables
-- Money (transactions), Category, Genre, Account masters

CREATE TABLE IF NOT EXISTS data_warehouse.raw_zaim__money (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v2'
);

CREATE INDEX IF NOT EXISTS idx_raw_zaim_money_synced_at
    ON data_warehouse.raw_zaim__money (synced_at);

CREATE TABLE IF NOT EXISTS data_warehouse.raw_zaim__category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v2'
);

CREATE INDEX IF NOT EXISTS idx_raw_zaim_category_synced_at
    ON data_warehouse.raw_zaim__category (synced_at);

CREATE TABLE IF NOT EXISTS data_warehouse.raw_zaim__genre (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v2'
);

CREATE INDEX IF NOT EXISTS idx_raw_zaim_genre_synced_at
    ON data_warehouse.raw_zaim__genre (synced_at);

CREATE TABLE IF NOT EXISTS data_warehouse.raw_zaim__account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v2'
);

CREATE INDEX IF NOT EXISTS idx_raw_zaim_account_synced_at
    ON data_warehouse.raw_zaim__account (synced_at);
