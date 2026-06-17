-- fct_health_sleep.sql
-- Daily sleep fact, sourced from Google Health sleep sessions.
-- One row per sleep_date (wake-day in JST), summing across all sessions
-- that ended that day (so naps and main sleep are combined).

with sessions as (
    select * from {{ ref('stg_google_health__sleep_sessions') }}
),

per_day as (
    select
        sleep_date,
        min(start_at)                          as start_at,
        max(end_at)                            as end_at,
        sum(duration_seconds)                  as duration_seconds,
        sum(minutes_asleep)                    as minutes_asleep,
        sum(minutes_awake)                     as minutes_awake,
        sum(time_in_bed)                       as time_in_bed,
        sum(deep_minutes)                      as deep_minutes,
        sum(light_minutes)                     as light_minutes,
        sum(rem_minutes)                       as rem_minutes,
        sum(wake_minutes)                      as wake_minutes,
        max(synced_at)                         as synced_at
    from sessions
    group by sleep_date
)

select
    md5(sleep_date::text)::uuid as id,
    md5(sleep_date::text)       as source_id,
    sleep_date,
    start_at,
    end_at,
    duration_seconds,
    case when time_in_bed > 0
         then round(minutes_asleep::numeric / time_in_bed * 100)::int
         else null
    end                         as efficiency,
    minutes_asleep,
    minutes_awake,
    time_in_bed,
    'STAGES'::text              as sleep_type,
    deep_minutes,
    light_minutes,
    rem_minutes,
    wake_minutes,
    synced_at
from per_day
