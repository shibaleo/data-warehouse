-- stg_notion__running.sql
-- Source: raw_notion__running_current (data_warehouse_v2, append-only).
--
-- TB__RUNNING shape:
--   datetime     title     ISO 8601 with +09:00 — source of truth for event time
--   type         select    walk / jog / run
--   surface      select    road / treadmill / trail / track / indoor
--   distance_km  number
--   duration_min number
--   rpe          number    perceived exertion, typically 1-10
--   memo         rich_text optional free-form note

with source as (
    select * from {{ ref('raw_notion__running_current') }}
),

staged as (
    select
        s.source_id,
        (s.data->>'created_time')::timestamptz   as notion_created_at,
        (s.data->>'last_edited_time')::timestamptz as notion_updated_at,
        (
            s.data->'properties'->'datetime'->'title'->0->>'plain_text'
        )::timestamptz as recorded_at,
        s.data->'properties'->'type'->'select'->>'name'           as activity_type,
        s.data->'properties'->'surface'->'select'->>'name'        as surface,
        (s.data->'properties'->'distance_km'->>'number')::numeric  as distance_km,
        (s.data->'properties'->'duration_min'->>'number')::numeric as duration_min,
        (s.data->'properties'->'rpe'->>'number')::numeric          as rpe,
        s.data->'properties'->'memo'->'rich_text'->0->>'plain_text' as memo,
        s.created_at as synced_at,
        s.api_version
    from source s
    where s.data->'properties'->'datetime'->'title'->0->>'plain_text' is not null
)

select * from staged
