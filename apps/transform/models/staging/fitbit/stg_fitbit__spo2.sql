-- Fitbit SpO2 (blood oxygen) staging model
-- Source: raw_fitbit__spo2_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__spo2_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        (data->>'avg_spo2')::numeric as avg_spo2,
        (data->>'min_spo2')::numeric as min_spo2,
        (data->>'max_spo2')::numeric as max_spo2,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
