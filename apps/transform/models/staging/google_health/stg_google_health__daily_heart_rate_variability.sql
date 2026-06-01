-- Google Health daily HRV staging model.

with source as (
    select * from {{ ref('raw_google_health__daily_heart_rate_variability_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        {{ google_health_civil_date("data->'dailyHeartRateVariability'->'date'") }} as civil_date,

        (data->'dailyHeartRateVariability'->>'averageHeartRateVariabilityMilliseconds')::numeric as average_hrv_ms,
        (data->'dailyHeartRateVariability'->>'nonRemHeartRateBeatsPerMinute')::numeric          as non_rem_heart_rate_bpm,
        (data->'dailyHeartRateVariability'->>'entropy')::numeric                                 as entropy,
        (data->'dailyHeartRateVariability'->>'deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds')::numeric as deep_sleep_rmssd_ms,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
