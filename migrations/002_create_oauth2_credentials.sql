-- 002_create_oauth2_credentials.sql
-- =============================================================================
-- OAuth2 credentials table for GAS connector
-- Stores tokens in Neon, refreshed by GAS on each API call
-- =============================================================================

CREATE TABLE IF NOT EXISTS data_warehouse.oauth2_credentials (
    service_name TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ,
    scope TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE data_warehouse.oauth2_credentials IS 'OAuth2 credentials for external services (Fitbit, etc.)';
