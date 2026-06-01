-- Google Health sleep sessions staging model.
-- Source: raw_google_health__sleep_current. Raw payload is the full v4
-- dataPoint; here we project the common-case columns and keep the stages
-- array verbatim for downstream consumers.

with source as (
    select * from {{ ref('raw_google_health__sleep_current') }}
),

staged as (
    select
        source_id,
        source_id as data_point_id,

        (data->'sleep'->'interval'->>'startTime')::timestamptz as start_time,
        (data->'sleep'->'interval'->>'endTime')::timestamptz   as end_time,
        ((data->'sleep'->'interval'->>'endTime')::timestamptz
         - (data->'sleep'->'interval'->>'startTime')::timestamptz) as duration,
        data->'sleep'->>'type' as sleep_type,

        data->'sleep'->'stages' as stages,

        data->'dataSource'->>'recordingMethod'         as recording_method,
        data->'dataSource'->'device'->>'displayName'   as device,
        data->'dataSource'->>'platform'                as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
