-- Google Health daily VO2 max staging model (Fitbit cardio_score successor).
-- Field set is provisional — no datapoints observed during probe; refine
-- once a real sample is captured.

with source as (
    select * from {{ ref('raw_google_health__daily_vo2_max_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        {{ google_health_civil_date("data->'dailyVo2Max'->'date'") }} as civil_date,

        -- Provisional shape based on docs/data-types reference.
        (data->'dailyVo2Max'->>'vo2Max')::numeric          as vo2_max,
        (data->'dailyVo2Max'->>'lowerBound')::numeric      as vo2_max_lower_bound,
        (data->'dailyVo2Max'->>'upperBound')::numeric      as vo2_max_upper_bound,

        data->'dailyVo2Max' as raw_payload,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
