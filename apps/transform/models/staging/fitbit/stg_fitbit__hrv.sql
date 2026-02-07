-- Fitbit HRV (heart rate variability) staging model
-- Source: raw_fitbit__hrv (Fitbit Web API v1)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__hrv') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Source identifier (date)
        source_id,
        source_id::date as date,

        -- HRV metrics (RMSSD = Root Mean Square of Successive Differences)
        (data->>'daily_rmssd')::numeric as daily_rmssd,
        (data->>'deep_rmssd')::numeric as deep_rmssd,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
