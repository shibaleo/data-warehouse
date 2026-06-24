-- fct_strength_session.sql
-- One row per Notion strength-log entry (= one logical session-line).
-- See docs/005 §3.3 for the column rationale; `volume_kg_reps` = weight × reps
-- is the simplest "total work" proxy until sets_count / rpe are added.

with source as (
    select * from {{ ref('stg_notion__strength') }}
)

select
    source_id,
    recorded_date,
    subject,
    weight_kg,
    reps,
    (weight_kg * reps)::numeric as volume_kg_reps,
    notion_created_at,
    notion_updated_at,
    synced_at
from source
