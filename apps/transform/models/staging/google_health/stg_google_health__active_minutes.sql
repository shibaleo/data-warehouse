-- Google Health active minutes staging model.
-- 1-minute granularity, broken down per activityLevel inside
-- activeMinutesByActivityLevel. We sum the array into a single
-- total_active_minutes column and keep the array for level-level analysis.

with source as (
    select * from {{ ref('raw_google_health__active_minutes_current') }}
),

staged as (
    select
        source_id,

        (data->'activeMinutes'->'interval'->>'startTime')::timestamptz as start_time,
        (data->'activeMinutes'->'interval'->>'endTime')::timestamptz   as end_time,

        (
            select coalesce(sum((elem->>'activeMinutes')::numeric), 0)
            from jsonb_array_elements(coalesce(data->'activeMinutes'->'activeMinutesByActivityLevel', '[]'::jsonb)) elem
        ) as total_active_minutes,

        data->'activeMinutes'->'activeMinutesByActivityLevel' as active_minutes_by_level,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
