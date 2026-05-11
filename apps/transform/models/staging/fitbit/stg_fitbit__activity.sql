-- Fitbit activity staging model
-- Source: raw_fitbit__activity_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ ref('raw_fitbit__activity_current') }}
),

staged as (
    select
        -- Source identifier (date)
        source_id,
        source_id::date as date,

        -- Steps and distance
        (data->>'steps')::integer as steps,
        (data->>'distance_km')::numeric as distance_km,
        (data->>'floors')::integer as floors,

        -- Calories
        (data->>'calories_total')::integer as calories_total,
        (data->>'calories_bmr')::integer as calories_bmr,
        (data->>'calories_activity')::integer as calories_activity,

        -- Activity minutes
        (data->>'sedentary_minutes')::integer as sedentary_minutes,
        (data->>'lightly_active_minutes')::integer as lightly_active_minutes,
        (data->>'fairly_active_minutes')::integer as fairly_active_minutes,
        (data->>'very_active_minutes')::integer as very_active_minutes,

        -- Total active minutes (calculated field)
        coalesce((data->>'lightly_active_minutes')::integer, 0) +
        coalesce((data->>'fairly_active_minutes')::integer, 0) +
        coalesce((data->>'very_active_minutes')::integer, 0) as total_active_minutes,

        -- Active zone minutes (JSONB)
        data->'active_zone_minutes' as active_zone_minutes,

        -- Audit
        created_at as synced_at,
        api_version

    from source
)

select * from staged
