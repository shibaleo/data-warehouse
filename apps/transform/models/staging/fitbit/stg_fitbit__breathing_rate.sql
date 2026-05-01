-- Fitbit breathing rate staging model
-- Source: raw_fitbit__breathing_rate_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__breathing_rate_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        (data->>'breathing_rate')::numeric as breathing_rate,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
