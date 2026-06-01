-- Google Health daily resting heart rate.
-- source_id is "YYYY-MM-DD" (civil date in user's timezone).

with source as (
    select * from {{ ref('raw_google_health__daily_resting_heart_rate_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        {{ google_health_civil_date("data->'dailyRestingHeartRate'->'date'") }} as civil_date,

        (data->'dailyRestingHeartRate'->>'beatsPerMinute')::numeric as resting_heart_rate,
        data->'dailyRestingHeartRate'->'dailyRestingHeartRateMetadata'->>'calculationMethod' as calculation_method,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
