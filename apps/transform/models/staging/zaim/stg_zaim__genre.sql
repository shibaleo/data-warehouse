-- stg_zaim__genre.sql
-- Source: raw_zaim__genre_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ source('raw_zaim', 'raw_zaim__genre_current') }}
),

staged as (
    select
        source_id,
        (data->>'id')::integer as genre_id,
        data->>'name' as name,
        (data->>'category_id')::integer as category_id,
        (data->>'parent_genre_id')::integer as parent_genre_id,
        (data->>'sort')::integer as sort_order,
        (data->>'active')::integer = 1 as is_active,
        (data->>'modified')::timestamptz as modified_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
