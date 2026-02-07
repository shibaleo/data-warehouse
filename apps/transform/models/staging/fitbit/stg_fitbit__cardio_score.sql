-- Fitbit cardio score (VO2 Max) staging model
-- Source: raw_fitbit__cardio_score (Fitbit Web API v1)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__cardio_score') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Source identifier (date)
        source_id,
        source_id::date as date,

        -- VO2 Max metrics
        (data->>'vo2_max')::numeric as vo2_max,
        (data->>'vo2_max_range_low')::numeric as vo2_max_range_low,
        (data->>'vo2_max_range_high')::numeric as vo2_max_range_high,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
