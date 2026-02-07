-- stg_tanita_health_planet__body_composition.sql
-- =============================================================================
-- Tanita Health Planet body composition staging model
-- Source: data_warehouse.raw_tanita_health_planet__body_composition (Health Planet API v1)
--
-- Health Planet InnerScan API data:
-- - Tag 6021: 体重 (weight) in kg
-- - Tag 6022: 体脂肪率 (body fat percent) in %
--
-- Note: source_id (ISO8601 UTC) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_tanita_health_planet', 'raw_tanita_health_planet__body_composition') }}
),

staged as (
    select
        id,
        source_id,
        source_id::timestamptz as measured_at,
        ((data->>'_measured_at_jst')::timestamptz at time zone 'Asia/Tokyo')::timestamp as measured_at_jst,
        (data->>'weight')::numeric as weight,
        (data->>'body_fat_percent')::numeric as body_fat_percent,
        data->>'model' as model,
        data->>'date' as raw_date,
        data->>'tag' as raw_tag,
        data->>'keydata' as raw_keydata,
        synced_at,
        api_version
    from source
)

select * from staged
