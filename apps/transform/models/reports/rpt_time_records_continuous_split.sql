-- rpt_time_records_continuous_split.sql
-- Day-split version of rpt_time_records_continuous (JST 00:00:00 boundary)
-- Visualization/BI only. DCMP does NOT reference this model.
-- (Formerly fct_time_records_actual_split)

with recursive source_records as (
    select
        source_id, start_at, end_at,
        (start_at at time zone 'Asia/Tokyo')::timestamp as start_jst,
        (end_at at time zone 'Asia/Tokyo')::timestamp as end_jst,
        description, project_name, project_color, tag_names,
        social_category, personal_category, coarse_personal_category,
        social_order, personal_order, coarse_order, project_order, source
    from {{ ref('rpt_time_records_continuous') }}
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
),

jp_holidays as (
    select jst_date, name as holiday_name
    from {{ ref('seed_jp_holidays') }}
)

select
    sr.source_id || '_' || sr.split_index as id,
    sr.source_id,
    (sr.start_jst at time zone 'Asia/Tokyo')::timestamptz as start_at,
    (least(sr.end_jst, (sr.start_jst::date + interval '1 day')::timestamp) at time zone 'Asia/Tokyo')::timestamptz as end_at,
    extract(epoch from
        least(sr.end_jst, (sr.start_jst::date + interval '1 day')::timestamp) - sr.start_jst
    )::integer as duration_seconds,
    sr.description, sr.project_name, sr.project_color, sr.tag_names,
    sr.social_category, sr.personal_category, sr.coarse_personal_category,
    sr.social_order, sr.personal_order, sr.coarse_order, sr.project_order, sr.source,
    sr.start_jst::date                              as jst_date,
    extract(hour from sr.start_jst)::smallint       as jst_hour,
    extract(dow  from sr.start_jst)::smallint       as jst_dow,
    to_char(sr.start_jst, 'Dy')                     as jst_dow_name,
    extract(dow from sr.start_jst) in (0, 6)        as is_weekend,
    (h.jst_date is not null)                        as is_jp_holiday,
    h.holiday_name                                  as jp_holiday_name
from split_records sr
left join jp_holidays h on h.jst_date = sr.start_jst::date
where sr.start_jst < least(sr.end_jst, (sr.start_jst::date + interval '1 day')::timestamp)
