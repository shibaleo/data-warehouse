-- Fitbit breathing rate staging model
-- Source: raw_fitbit__breathing_rate (Fitbit Web API v1)

with source as (
    select * from {{ source('raw_fitbit', 'raw_fitbit__breathing_rate') }}
),

staged as (
    select
        -- Primary key
        id,

        -- Source identifier (date)
        source_id,
        source_id::date as date,

        -- Breathing rate (breaths per minute)
        (data->>'breathing_rate')::numeric as breathing_rate,

        -- Audit
        synced_at,
        api_version

    from source
)

select * from staged
