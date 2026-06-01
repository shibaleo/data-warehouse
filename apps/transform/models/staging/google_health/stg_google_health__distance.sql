-- Google Health distance staging model.
-- Sub-minute interval points; values arrive in millimeters as string.

with source as (
    select * from {{ ref('raw_google_health__distance_current') }}
),

staged as (
    select
        source_id,

        (data->'distance'->'interval'->>'startTime')::timestamptz as start_time,
        (data->'distance'->'interval'->>'endTime')::timestamptz   as end_time,
        (data->'distance'->>'millimeters')::bigint                 as distance_mm,
        (data->'distance'->>'millimeters')::numeric / 1000000.0    as distance_km,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
