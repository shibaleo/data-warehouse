-- Google Health steps staging model.
-- Sub-minute interval points; source_id is composite
-- "<startTime>__<recordingMethod>__<device>" so multiple devices reporting
-- the same minute (e.g. MobileTrack + Inspire 3) don't collide.

with source as (
    select * from {{ ref('raw_google_health__steps_current') }}
),

staged as (
    select
        source_id,

        (data->'steps'->'interval'->>'startTime')::timestamptz as start_time,
        (data->'steps'->'interval'->>'endTime')::timestamptz   as end_time,
        (data->'steps'->>'count')::bigint                       as steps,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
