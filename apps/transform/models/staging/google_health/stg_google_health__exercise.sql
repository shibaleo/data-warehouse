-- Google Health exercise sessions staging model.
-- source_id is the name's last segment (stable Google ID).

with source as (
    select * from {{ ref('raw_google_health__exercise_current') }}
),

staged as (
    select
        source_id,
        source_id as data_point_id,

        (data->'exercise'->'interval'->>'startTime')::timestamptz as start_time,
        (data->'exercise'->'interval'->>'endTime')::timestamptz   as end_time,
        data->'exercise'->>'exerciseType'  as exercise_type,
        data->'exercise'->>'displayName'   as display_name,

        -- activeDuration arrives as "1179s" — strip the trailing "s" and cast.
        nullif(rtrim(data->'exercise'->>'activeDuration', 's'), '')::numeric as active_duration_seconds,

        (data->'exercise'->'metricsSummary'->>'caloriesKcal')::numeric                   as calories_kcal,
        (data->'exercise'->'metricsSummary'->>'distanceMillimeters')::numeric            as distance_mm,
        (data->'exercise'->'metricsSummary'->>'steps')::bigint                           as steps,
        (data->'exercise'->'metricsSummary'->>'averagePaceSecondsPerMeter')::numeric     as average_pace_sec_per_m,
        (data->'exercise'->'metricsSummary'->>'averageHeartRateBeatsPerMinute')::numeric as average_heart_rate_bpm,
        (data->'exercise'->'metricsSummary'->>'elevationGainMillimeters')::numeric       as elevation_gain_mm,
        (data->'exercise'->'metricsSummary'->>'activeZoneMinutes')::numeric              as active_zone_minutes,

        data->'exercise'->'metricsSummary'->'heartRateZoneDurations' as heart_rate_zone_durations,
        data->'exercise'->'exerciseEvents'                            as exercise_events,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
