-- Google Health daily sleep temperature derivations staging model.

with source as (
    select * from {{ ref('raw_google_health__daily_sleep_temperature_derivations_current') }}
),

staged as (
    select
        source_id,
        source_id::date as date,
        {{ google_health_civil_date("data->'dailySleepTemperatureDerivations'->'date'") }} as civil_date,

        (data->'dailySleepTemperatureDerivations'->>'nightlyTemperatureCelsius')::numeric         as nightly_temperature_celsius,
        (data->'dailySleepTemperatureDerivations'->>'baselineTemperatureCelsius')::numeric        as baseline_temperature_celsius,
        ((data->'dailySleepTemperatureDerivations'->>'nightlyTemperatureCelsius')::numeric
         - (data->'dailySleepTemperatureDerivations'->>'baselineTemperatureCelsius')::numeric)    as nightly_relative_celsius,
        (data->'dailySleepTemperatureDerivations'->>'relativeNightlyStddev30dCelsius')::numeric   as nightly_relative_stddev_30d_celsius,

        data->'dataSource'->>'recordingMethod'        as recording_method,
        data->'dataSource'->'device'->>'displayName'  as device,
        data->'dataSource'->>'platform'               as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
