-- Sleep session reconstruction from Google Health raw stages.
--
-- Why this exists: raw_google_health__sleep records have two failure modes
-- when aggregated naïvely:
--   1. Backfill batches duplicate identical (type, start, end) stages across
--      multiple raw rows. Grouping by created_at double-counts them.
--   2. A single raw row's stages array can span multiple nights, so the raw
--      grain ≠ sleep-session grain.
-- Both are resolved by unnesting stages, DISTINCT-ing on (type, start, end),
-- and re-sessioning by a >2h gap between consecutive stages.
--
-- Labeling: sessions are labeled by wake_date (JST date of session end),
-- which matches fct_health_sleep's existing semantics. This differs from
-- stg_google_health__sleep.sleep_date (bed-day attribution).

with all_stages as (
    select distinct
        (st->>'type')                    as stype,
        (st->>'startTime')::timestamptz  as s0,
        (st->>'endTime')::timestamptz    as s1
    from {{ ref('raw_google_health__sleep_current') }},
         jsonb_array_elements(data->'sleep'->'stages') st
    where data->'sleep' ? 'stages'
),

ordered as (
    select
        stype, s0, s1,
        lag(s1) over (order by s0) as prev_end
    from all_stages
),

sessioned as (
    select
        stype, s0, s1,
        sum(case when prev_end is null or s0 - prev_end > interval '2 hours'
                 then 1 else 0 end) over (order by s0) as sid
    from ordered
),

sess as (
    select
        sid,
        (max(s1) at time zone 'Asia/Tokyo')::date          as wake_date,
        min(s0)                                            as start_at,
        max(s1)                                            as end_at,
        sum(extract(epoch from (s1-s0))) filter (where stype <> 'AWAKE')/60.0 as minutes_asleep_f,
        sum(extract(epoch from (s1-s0))) filter (where stype = 'AWAKE')/60.0  as minutes_awake_f,
        sum(extract(epoch from (s1-s0))) filter (where stype = 'DEEP')/60.0   as deep_minutes_f,
        sum(extract(epoch from (s1-s0))) filter (where stype = 'LIGHT')/60.0  as light_minutes_f,
        sum(extract(epoch from (s1-s0))) filter (where stype = 'REM')/60.0    as rem_minutes_f,
        sum(extract(epoch from (s1-s0))) filter (where stype = 'AWAKE')/60.0  as wake_minutes_f
    from sessioned
    group by sid
),

synced as (
    -- Attach the latest contributing raw batch's created_at, so downstream
    -- freshness checks see a real timestamp instead of now().
    select max(created_at) as max_created_at
    from {{ ref('raw_google_health__sleep_current') }}
)

select
    md5(start_at::text)::uuid                              as id,
    md5(start_at::text)                                    as source_id,
    wake_date                                              as sleep_date,
    start_at,
    end_at,
    extract(epoch from (end_at - start_at))::bigint        as duration_seconds,
    case when extract(epoch from (end_at - start_at)) > 0
         then round((minutes_asleep_f * 60.0)
                    / extract(epoch from (end_at - start_at)) * 100)::int
         else null
    end                                                    as efficiency,
    round(minutes_asleep_f)::int                           as minutes_asleep,
    round(minutes_awake_f)::int                            as minutes_awake,
    round(extract(epoch from (end_at - start_at))/60.0)::int as time_in_bed,
    'STAGES'::text                                         as sleep_type,
    round(deep_minutes_f)::int                             as deep_minutes,
    round(light_minutes_f)::int                            as light_minutes,
    round(rem_minutes_f)::int                              as rem_minutes,
    round(wake_minutes_f)::int                             as wake_minutes,
    (select max_created_at from synced)                    as synced_at
from sess
