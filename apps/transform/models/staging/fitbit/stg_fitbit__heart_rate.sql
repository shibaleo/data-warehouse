-- Fitbit heart rate staging model
-- Source: raw_fitbit__heart_rate_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__heart_rate_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        (data->>'resting_heart_rate')::integer as resting_heart_rate,
        data->'heart_rate_zones' as heart_rate_zones,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
