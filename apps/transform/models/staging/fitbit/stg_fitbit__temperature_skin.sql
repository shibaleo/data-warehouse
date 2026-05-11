-- Fitbit skin temperature staging model
-- Source: raw_fitbit__temperature_skin_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ ref('raw_fitbit__temperature_skin_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        (data->>'nightly_relative')::numeric as nightly_relative,
        data->>'log_type' as log_type,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
