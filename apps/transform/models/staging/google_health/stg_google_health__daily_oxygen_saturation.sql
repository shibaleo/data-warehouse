-- Google Health daily SpO2 staging model.

with source as (
    select * from {{ ref('raw_google_health__daily_oxygen_saturation_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        {{ google_health_civil_date("data->'dailyOxygenSaturation'->'date'") }} as civil_date,

        (data->'dailyOxygenSaturation'->>'averagePercentage')::numeric           as average_spo2,
        (data->'dailyOxygenSaturation'->>'lowerBoundPercentage')::numeric        as lower_bound_spo2,
        (data->'dailyOxygenSaturation'->>'upperBoundPercentage')::numeric        as upper_bound_spo2,
        (data->'dailyOxygenSaturation'->>'standardDeviationPercentage')::numeric as stddev_spo2,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
