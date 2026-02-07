-- Fitbit sleep staging model
-- Source: raw_fitbit__sleep (Fitbit Web API v1.2)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__sleep') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Source identifier (log_id)
        source_id,
        source_id as log_id,

        -- Sleep date and times
        (data->>'date')::date as date,
        (data->>'start_time')::timestamptz as start_time,
        (data->>'end_time')::timestamptz as end_time,

        -- Duration
        (data->>'duration_ms')::integer as duration_ms,
        ((data->>'duration_ms')::integer / 1000 / 60)::integer as duration_minutes,

        -- Sleep quality
        (data->>'efficiency')::integer as efficiency,
        (data->>'is_main_sleep')::boolean as is_main_sleep,

        -- Sleep breakdown
        (data->>'minutes_asleep')::integer as minutes_asleep,
        (data->>'minutes_awake')::integer as minutes_awake,
        (data->>'time_in_bed')::integer as time_in_bed,

        -- Sleep type (stages or classic)
        data->>'sleep_type' as sleep_type,

        -- Sleep stages summary (for stages type)
        (data->'levels'->'summary'->'deep'->>'minutes')::integer as deep_minutes,
        (data->'levels'->'summary'->'light'->>'minutes')::integer as light_minutes,
        (data->'levels'->'summary'->'rem'->>'minutes')::integer as rem_minutes,
        (data->'levels'->'summary'->'wake'->>'minutes')::integer as wake_minutes,

        -- Full levels data (for detailed analysis)
        data->'levels' as levels,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
