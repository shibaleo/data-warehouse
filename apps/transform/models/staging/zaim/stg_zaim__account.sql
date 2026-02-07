-- stg_zaim__account.sql
-- =============================================================================
-- Zaim account master staging model
-- Source: data_warehouse.raw_zaim__account (Zaim API v2)
--
-- Account types: wallet, bank account, credit card, e-money, etc.
--
-- Note: source_id (Zaim account id) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_zaim', 'raw_zaim__account') }}
),

staged as (
    select
        id,
        source_id,
        (data->>'id')::integer as account_id,
        data->>'name' as name,
        (data->>'parent_account_id')::integer as parent_account_id,
        (data->>'local_id')::integer as local_id,
        (data->>'website_id')::integer as website_id,
        (data->>'sort')::integer as sort_order,
        (data->>'active')::integer = 1 as is_active,
        (data->>'modified')::timestamptz as modified_at,
        synced_at,
        api_version
    from source
)

select * from staged
