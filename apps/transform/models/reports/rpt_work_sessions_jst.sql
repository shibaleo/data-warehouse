-- rpt_work_sessions_jst.sql
-- 1 営業日 = 1 行に再集約した Work セッションビュー。
-- Toggl が昼休み等で物理分割したエントリーを業務認識単位に統合する。
-- Visualization/BI only. DCMP does NOT reference this model.

with work_records as (
    select
        (start_at at time zone 'Asia/Tokyo')::date as jst_date,
        start_at,
        end_at,
        duration_seconds,
        project_name
    from {{ ref('rpt_time_records_continuous_split') }}
    where personal_category = 'Work'
)

select
    jst_date,
    (min(start_at) at time zone 'Asia/Tokyo')::timestamp as session_start_jst,
    (max(end_at)   at time zone 'Asia/Tokyo')::timestamp as session_end_jst,
    sum(duration_seconds) / 60 as work_minutes,
    extract(epoch from (max(end_at) - min(start_at)))::integer / 60
        - sum(duration_seconds) / 60 as break_minutes,
    count(*) as entry_count,
    array_agg(distinct project_name order by project_name) as project_names
from work_records
group by jst_date
order by jst_date
