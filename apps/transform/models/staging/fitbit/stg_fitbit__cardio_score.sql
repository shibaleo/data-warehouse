-- Fitbit cardio score (VO2 Max) staging model
-- Source: raw_fitbit__cardio_score_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ ref('raw_fitbit__cardio_score_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        (data->>'vo2_max')::numeric as vo2_max,
        (data->>'vo2_max_range_low')::numeric as vo2_max_range_low,
        (data->>'vo2_max_range_high')::numeric as vo2_max_range_high,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
