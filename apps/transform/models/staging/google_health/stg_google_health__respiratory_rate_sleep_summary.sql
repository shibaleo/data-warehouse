-- Google Health respiratory rate sleep summary staging model.
-- Entity is currently un-populated: the v4 API rejects every filter field
-- candidate we have tried (see docs/002 Unresolved TODOs #1), so
-- syncGoogleHealthAll() skips it. This model is included for completeness
-- so that the moment a valid filter is found and rows start landing, the
-- stg layer is already wired up.

with source as (
    select * from {{ ref('raw_google_health__respiratory_rate_sleep_summary_current') }}
),

staged as (
    select
        source_id,
        source_id::timestamptz as sample_time,

        (data->'respiratoryRateSleepSummary'->>'breathsPerMinute')::numeric as breaths_per_minute,
        data->'respiratoryRateSleepSummary' as raw_payload,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
