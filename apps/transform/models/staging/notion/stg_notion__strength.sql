-- stg_notion__strength.sql
-- Source: raw_notion__strength_current (data_warehouse_v2, append-only).
--
-- Notion stores property values inside data->'properties'->'<name>'->...,
-- shaped by the property type. We pull the four relevant properties
-- (`date`, `subject`, `weight`, `number`) and the page-level built-ins.
--
-- `date` falls back to `created_time::date` if the user didn't fill the
-- date property explicitly (the common case for "log right after the
-- session" — see docs/005 §2 "v1 で sync する最小カラム").

with source as (
    select * from {{ ref('raw_notion__strength_current') }}
),

staged as (
    select
        s.source_id,
        (s.data->>'created_time')::timestamptz as notion_created_at,
        (s.data->>'last_edited_time')::timestamptz as notion_updated_at,
        coalesce(
            (s.data->'properties'->'date'->'date'->>'start')::date,
            (s.data->>'created_time')::timestamptz::date
        ) as recorded_date,
        s.data->'properties'->'subject'->'select'->>'name' as subject,
        (s.data->'properties'->'weight'->>'number')::numeric as weight_kg,
        (s.data->'properties'->'number'->>'number')::integer as reps,
        s.created_at as synced_at,
        s.api_version
    from source s
    where s.data->'properties'->'subject'->'select'->>'name' is not null
)

select * from staged
