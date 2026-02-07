-- Fitbit SpO2 (blood oxygen) staging model
-- Source: raw_fitbit__spo2 (Fitbit Web API v1)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__spo2') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Source identifier (date)
        source_id,
        source_id::date as date,

        -- SpO2 metrics
        (data->>'avg_spo2')::numeric as avg_spo2,
        (data->>'min_spo2')::numeric as min_spo2,
        (data->>'max_spo2')::numeric as max_spo2,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
