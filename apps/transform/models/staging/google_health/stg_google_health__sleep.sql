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

        -- "sleep_date" = the date the sleep is conceptually attributed to.
        -- Convention (matching Fitbit's dateOfSleep semantics): the day the
        -- user went to bed, which is the calendar day before the JST wake
        -- time. e.g. an end_time of 2026-05-31 11:58 JST → sleep_date
        -- 2026-05-30 (the user got into bed late on 5/30). This works for
        -- both overnight (bed at 23:xx, wake 06:xx next day) and shifted
        -- (bed at 01:xx, wake 11:xx same day) sessions.
        ((data->'sleep'->'interval'->>'endTime')::timestamptz
            AT TIME ZONE 'Asia/Tokyo')::date - 1 as sleep_date,

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
