-- Fitbit HRV (heart rate variability) staging model
-- Source: raw_fitbit__hrv_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__hrv_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        (data->>'daily_rmssd')::numeric as daily_rmssd,
        (data->>'deep_rmssd')::numeric as deep_rmssd,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
