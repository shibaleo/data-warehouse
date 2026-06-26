-- fct_running_session.sql
-- One row per Notion running-log entry.
-- pace_min_per_km / speed_kmh are derived for convenience; downstream
-- consumers can recompute from distance / duration if needed.

with source as (
    select * from {{ ref('stg_notion__running') }}
)

select
    source_id,
    recorded_at,
    (recorded_at at time zone 'Asia/Tokyo')::date as recorded_date,
    activity_type,
    surface,
    distance_km,
    duration_min,
    case
        when distance_km > 0 then (duration_min / distance_km)::numeric
    end as pace_min_per_km,
    case
        when duration_min > 0 then (distance_km / (duration_min / 60.0))::numeric
    end as speed_kmh,
    rpe,
    memo,
    notion_created_at,
    notion_updated_at,
    synced_at
from source
