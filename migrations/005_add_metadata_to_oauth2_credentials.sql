-- 005_add_metadata_to_oauth2_credentials.sql
-- =============================================================================
-- Add metadata JSONB column for service-specific fields (e.g. redirect_uri)
-- =============================================================================

ALTER TABLE data_warehouse.oauth2_credentials
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN data_warehouse.oauth2_credentials.metadata IS 'Service-specific metadata (e.g. redirect_uri for Tanita)';
