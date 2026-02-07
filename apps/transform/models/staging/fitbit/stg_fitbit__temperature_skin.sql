-- Fitbit skin temperature staging model
-- Source: raw_fitbit__temperature_skin (Fitbit Web API v1)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__temperature_skin') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Source identifier (date)
        source_id,
        source_id::date as date,

        -- Temperature metrics (relative to baseline)
        (data->>'nightly_relative')::numeric as nightly_relative,

        -- Log type
        data->>'log_type' as log_type,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
