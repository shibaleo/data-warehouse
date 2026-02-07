-- fct_health_sleep.sql
-- Daily sleep fact from Fitbit sleep data
-- One row per sleep_date (main sleep only)

with sleep_records as (
    select
        id,
        source_id,
        date as sleep_date,
        start_time as start_at,
        end_time as end_at,
        duration_ms / 1000 as duration_seconds,
        efficiency,
        is_main_sleep,
        minutes_asleep,
        minutes_awake,
        time_in_bed,
        sleep_type,
        deep_minutes,
        light_minutes,
        rem_minutes,
        wake_minutes,
        synced_at
    from {{ ref('stg_fitbit__sleep') }}
    where is_main_sleep = true
),

deduplicated as (
    select
        *,
        row_number() over (
            partition by sleep_date
            order by duration_seconds desc
        ) as rn
    from sleep_records
)

select
    id,
    source_id,
    sleep_date,
    start_at,
    end_at,
    duration_seconds,
    efficiency,
    minutes_asleep,
    minutes_awake,
    time_in_bed,
    sleep_type,
    deep_minutes,
    light_minutes,
    rem_minutes,
    wake_minutes,
    synced_at
from deduplicated
where rn = 1
