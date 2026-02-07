-- stg_zaim__genre.sql
-- =============================================================================
-- Zaim genre (subcategory) master staging model
-- Source: data_warehouse.raw_zaim__genre (Zaim API v2)
--
-- Genre is a subcategory within a category.
-- Example: Category "食費" -> Genre "食料品", "外食", etc.
--
-- Note: source_id (Zaim genre id) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_zaim', 'raw_zaim__genre') }}
),

staged as (
    select
        id,
        source_id,
        (data->>'id')::integer as genre_id,
        data->>'name' as name,
        (data->>'category_id')::integer as category_id,
        (data->>'parent_genre_id')::integer as parent_genre_id,
        (data->>'sort')::integer as sort_order,
        (data->>'active')::integer = 1 as is_active,
        (data->>'modified')::timestamptz as modified_at,
        synced_at,
        api_version
    from source
)

select * from staged
