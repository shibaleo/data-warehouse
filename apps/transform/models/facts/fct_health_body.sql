-- fct_health_body.sql
-- Body composition fact from Tanita Health Planet
-- One row per measurement date

with source as (
    select * from {{ ref('stg_tanita_health_planet__body_composition') }}
),

deduplicated as (
    select
        *,
        row_number() over (
            partition by measured_at::date
            order by measured_at desc
        ) as rn
    from source
)

select
    id,
    source_id,
    measured_at,
    measured_at::date as measured_date,
    weight,
    body_fat_percent,
    synced_at
from deduplicated
where rn = 1
