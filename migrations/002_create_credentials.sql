-- 002_create_credentials.sql
-- =============================================================================
-- Credentials table for GAS connector
-- Stores API tokens and OAuth2 tokens, refreshed by GAS on each API call
-- =============================================================================

CREATE TABLE IF NOT EXISTS data_warehouse.credentials (
    service_name TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ,
    scope TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE data_warehouse.credentials IS 'Credentials for external services (Fitbit, Tanita, Zaim, Toggl)';
COMMENT ON COLUMN data_warehouse.credentials.metadata IS 'Service-specific metadata (e.g. redirect_uri, workspace_id)';
