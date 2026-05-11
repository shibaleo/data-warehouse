-- stg_zaim__category.sql
-- Source: raw_zaim__category_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ ref('raw_zaim__category_current') }}
),

staged as (
    select
        source_id,
        (data->>'id')::integer as category_id,
        data->>'name' as name,
        data->>'mode' as mode,
        (data->>'parent_category_id')::integer as parent_category_id,
        (data->>'sort')::integer as sort_order,
        (data->>'active')::integer = 1 as is_active,
        (data->>'modified')::timestamptz as modified_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
