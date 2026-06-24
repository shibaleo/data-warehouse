-- stg_notion__orgasm.sql
-- Source: raw_notion__orgasm_current (data_warehouse_v2, append-only).
--
-- Field strategy:
--   - occurred_at uses Notion's `created_time` (server-generated, never
--     malformed). The DB's Title column holds a user-typed ISO string, but
--     we ignore it because it's fragile (no schema enforcement on Title).
--   - behaviors is a multi_select — kept as text[] so downstream can
--     unnest() for breakdowns without losing the array semantics.
--   - memo concatenates all rich_text plain_text segments (Notion splits
--     formatted runs into multiple objects).

with source as (
    select * from {{ ref('raw_notion__orgasm_current') }}
),

staged as (
    select
        s.source_id,
        (s.data->>'created_time')::timestamptz as occurred_at,
        ((s.data->>'created_time')::timestamptz at time zone 'Asia/Tokyo')::date as occurred_date,
        s.data->'properties'->'type'->'select'->>'name' as type,
        coalesce(
            (
                select array_agg(elem->>'name' order by ord)
                from jsonb_array_elements(s.data->'properties'->'behavior'->'multi_select')
                     with ordinality as t(elem, ord)
            ),
            array[]::text[]
        ) as behaviors,
        (
            select string_agg(elem->>'plain_text', '' order by ord)
            from jsonb_array_elements(s.data->'properties'->'memo'->'rich_text')
                 with ordinality as t(elem, ord)
        ) as memo,
        (s.data->>'created_time')::timestamptz as notion_created_at,
        (s.data->>'last_edited_time')::timestamptz as notion_updated_at,
        s.created_at as synced_at,
        s.api_version
    from source s
)

select * from staged
