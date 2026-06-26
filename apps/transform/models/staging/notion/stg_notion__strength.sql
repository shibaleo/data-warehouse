-- stg_notion__strength.sql
-- Source: raw_notion__strength_current (data_warehouse_v2, append-only).
--
-- New TB__STRENGTH shape (2026-06-26 rename):
--   datetime  title     ISO 8601 with +09:00 — source of truth for event time
--   subject   select    sit-up / shoulder-press / push-up / ... / linear-leg-press
--   reps      number
--   weight_kg number
--   memo      rich_text optional free-form note (form feel, PR sensation, etc.)
--
-- `datetime` is authored by the user explicitly, so we parse it as
-- timestamptz directly. created_time fallback (used in the old `date`
-- column shape) is no longer needed.

with source as (
    select * from {{ ref('raw_notion__strength_current') }}
),

staged as (
    select
        s.source_id,
        (s.data->>'created_time')::timestamptz   as notion_created_at,
        (s.data->>'last_edited_time')::timestamptz as notion_updated_at,
        (
            s.data->'properties'->'datetime'->'title'->0->>'plain_text'
        )::timestamptz as recorded_at,
        s.data->'properties'->'subject'->'select'->>'name'      as subject,
        (s.data->'properties'->'weight_kg'->>'number')::numeric as weight_kg,
        (s.data->'properties'->'reps'->>'number')::integer      as reps,
        s.data->'properties'->'memo'->'rich_text'->0->>'plain_text' as memo,
        s.created_at as synced_at,
        s.api_version
    from source s
    where s.data->'properties'->'subject'->'select'->>'name' is not null
)

select * from staged
