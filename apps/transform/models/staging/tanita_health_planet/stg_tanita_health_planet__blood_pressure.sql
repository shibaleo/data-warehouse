-- stg_tanita_health_planet__blood_pressure.sql
-- Source: raw_tanita_health_planet__blood_pressure_current (data_warehouse_v2, append-only)

with source as (
    select * from {{ source('raw_tanita_health_planet', 'raw_tanita_health_planet__blood_pressure_current') }}
),

staged as (
    select
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
        created_at as synced_at,
        api_version
    from source
)

select * from staged
