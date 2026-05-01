-- stg_zaim__account.sql
-- Source: raw_zaim__account_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ source('raw_zaim', 'raw_zaim__account_current') }}
),

staged as (
    select
        source_id,
        (data->>'id')::integer as account_id,
        data->>'name' as name,
        (data->>'parent_account_id')::integer as parent_account_id,
        (data->>'local_id')::integer as local_id,
        (data->>'website_id')::integer as website_id,
        (data->>'sort')::integer as sort_order,
        (data->>'active')::integer = 1 as is_active,
        (data->>'modified')::timestamptz as modified_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
