-- stg_tanita_health_planet__blood_pressure.sql
-- =============================================================================
-- Tanita Health Planet blood pressure staging model
-- Source: data_warehouse.raw_tanita_health_planet__blood_pressure (Health Planet API v1)
--
-- Health Planet Sphygmomanometer API data:
-- - Tag 622E: 最高血圧 (systolic) in mmHg
-- - Tag 622F: 最低血圧 (diastolic) in mmHg
-- - Tag 6230: 脈拍 (pulse) in bpm
--
-- Note: source_id (ISO8601 UTC) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_tanita_health_planet', 'raw_tanita_health_planet__blood_pressure') }}
),

staged as (
    select
        id,
        source_id,
        source_id::timestamptz as measured_at,
        ((data->>'_measured_at_jst')::timestamptz at time zone 'Asia/Tokyo')::timestamp as measured_at_jst,
        (data->>'systolic')::integer as systolic,
        (data->>'diastolic')::integer as diastolic,
        (data->>'pulse')::integer as pulse,
        data->>'model' as model,
        data->>'date' as raw_date,
        data->>'tag' as raw_tag,
        data->>'keydata' as raw_keydata,
        synced_at,
        api_version
    from source
)

select * from staged
