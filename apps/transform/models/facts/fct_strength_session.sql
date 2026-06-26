-- fct_strength_session.sql
-- One row per Notion strength-log entry (= one logical set).
-- `volume_kg_reps` = weight × reps as a simple "total work" proxy.

with source as (
    select * from {{ ref('stg_notion__strength') }}
)

select
    source_id,
    recorded_at,
    (recorded_at at time zone 'Asia/Tokyo')::date as recorded_date,
    subject,
    weight_kg,
    reps,
    (weight_kg * reps)::numeric as volume_kg_reps,
    memo,
    notion_created_at,
    notion_updated_at,
    synced_at
from source
