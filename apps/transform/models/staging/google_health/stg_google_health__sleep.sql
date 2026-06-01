-- Google Health sleep sessions staging model.
-- Source: raw_google_health__sleep_current. Raw payload is the full v4
-- dataPoint; here we project the common-case columns and keep the stages
-- array verbatim for downstream consumers.

with source as (
    select * from {{ ref('raw_google_health__sleep_current') }}
),

staged as (
    select
        source_id,
        source_id as data_point_id,

        (data->'sleep'->'interval'->>'startTime')::timestamptz as start_time,
        (data->'sleep'->'interval'->>'endTime')::timestamptz   as end_time,
        ((data->'sleep'->'interval'->>'endTime')::timestamptz
         - (data->'sleep'->'interval'->>'startTime')::timestamptz) as duration,

        -- "sleep_date" = the date the sleep is conceptually attributed to.
        -- Three cases:
        --   (1) Crosses midnight (bed_date != wake_date) → bed_date.
        --       e.g. bed 23:00 5/31, wake 06:47 6/1 → sleep_date 5/31
        --   (2) Same-day, wake hour < 12 (morning) → bed_date - 1.
        --       Treats it as continuation of last night's main sleep —
        --       includes二度寝, post-all-nighter morning sleep, and
        --       bed-after-midnight cases.
        --       e.g. bed 01:56 5/31, wake 11:58 5/31 → sleep_date 5/30
        --       e.g. bed 10:27 4/4 (二度寝), wake 11:40 4/4 → sleep_date 4/3
        --   (3) Same-day, wake hour >= 12 (afternoon/evening) → bed_date.
        --       Genuine nap, attributed to today.
        --       e.g. bed 15:08 4/25, wake 16:09 4/25 → sleep_date 4/25
        --       e.g. bed 12:06 4/5, wake 13:45 4/5 → sleep_date 4/5
        -- The noon cutoff on wake_time is the only threshold; it discriminates
        -- "morning continuation of last night" from "today's afternoon/evening nap".
        CASE
          WHEN ((data->'sleep'->'interval'->>'startTime')::timestamptz AT TIME ZONE 'Asia/Tokyo')::date
            <> ((data->'sleep'->'interval'->>'endTime')::timestamptz AT TIME ZONE 'Asia/Tokyo')::date
            THEN ((data->'sleep'->'interval'->>'startTime')::timestamptz AT TIME ZONE 'Asia/Tokyo')::date
          WHEN extract(hour from (data->'sleep'->'interval'->>'endTime')::timestamptz AT TIME ZONE 'Asia/Tokyo') < 12
            THEN ((data->'sleep'->'interval'->>'startTime')::timestamptz AT TIME ZONE 'Asia/Tokyo')::date - 1
          ELSE ((data->'sleep'->'interval'->>'startTime')::timestamptz AT TIME ZONE 'Asia/Tokyo')::date
        END as sleep_date,

        data->'sleep'->>'type' as sleep_type,

        data->'sleep'->'stages' as stages,

        data->'dataSource'->>'recordingMethod'         as recording_method,
        data->'dataSource'->'device'->>'displayName'   as device,
        data->'dataSource'->>'platform'                as platform,

        created_at as synced_at,
        api_version

    from source
)

select * from staged
