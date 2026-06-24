-- fct_orgasm_event.sql
-- One row per TB__ORGASM page. Derives JST-local time-of-day / weekday
-- so digest-side time-pattern visualisations don't need to re-do the TZ
-- math on every query.

with source as (
    select * from {{ ref('stg_notion__orgasm') }}
)

select
    source_id,
    occurred_at,
    occurred_date,
    type,
    behaviors,
    cardinality(behaviors) as n_behaviors,
    memo,
    extract(hour from occurred_at at time zone 'Asia/Tokyo')::int as hour_of_day,
    extract(dow  from occurred_at at time zone 'Asia/Tokyo')::int as dow,
    notion_created_at,
    notion_updated_at,
    synced_at
from source
