-- fct_time_records_actual_split.sql
-- Day-split version of fct_time_records_actual (JST 00:00:00 boundary)

with recursive source_records as (
    select
        source_id, start_at, end_at,
        (start_at at time zone 'Asia/Tokyo')::timestamp as start_jst,
        (end_at at time zone 'Asia/Tokyo')::timestamp as end_jst,
        description, project_name, project_color, tag_names,
        social_category, personal_category, coarse_personal_category,
        social_order, personal_order, coarse_order, project_order, source
    from {{ ref('fct_time_records_actual') }}
),

split_records as (
    select
        source_id, 1 as split_index,
        start_jst, end_jst,
        description, project_name, project_color, tag_names,
        social_category, personal_category, coarse_personal_category,
        social_order, personal_order, coarse_order, project_order, source
    from source_records

    union all

    select
        source_id, split_index + 1,
        (start_jst::date + interval '1 day')::timestamp as start_jst,
        end_jst,
        description, project_name, project_color, tag_names,
        social_category, personal_category, coarse_personal_category,
        social_order, personal_order, coarse_order, project_order, source
    from split_records
    where start_jst::date < end_jst::date
)

select
    source_id || '_' || split_index as id,
    source_id,
    (start_jst at time zone 'Asia/Tokyo')::timestamptz as start_at,
    (least(end_jst, (start_jst::date + interval '1 day')::timestamp) at time zone 'Asia/Tokyo')::timestamptz as end_at,
    extract(epoch from
        least(end_jst, (start_jst::date + interval '1 day')::timestamp) - start_jst
    )::integer as duration_seconds,
    description, project_name, project_color, tag_names,
    social_category, personal_category, coarse_personal_category,
    social_order, personal_order, coarse_order, project_order, source
from split_records
where start_jst < least(end_jst, (start_jst::date + interval '1 day')::timestamp)
