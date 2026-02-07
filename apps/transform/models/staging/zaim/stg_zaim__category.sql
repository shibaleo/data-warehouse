-- stg_zaim__category.sql
-- =============================================================================
-- Zaim category master staging model
-- Source: data_warehouse.raw_zaim__category (Zaim API v2)
--
-- Category modes:
-- - payment: 支出カテゴリ
-- - income: 収入カテゴリ
--
-- Note: source_id (Zaim category id) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_zaim', 'raw_zaim__category') }}
),

staged as (
    select
        id,
        source_id,
        (data->>'id')::integer as category_id,
        data->>'name' as name,
        data->>'mode' as mode,
        (data->>'parent_category_id')::integer as parent_category_id,
        (data->>'sort')::integer as sort_order,
        (data->>'active')::integer = 1 as is_active,
        (data->>'modified')::timestamptz as modified_at,
        synced_at,
        api_version
    from source
)

select * from staged
