-- fct_toggl_time_entries.sql
-- Clean denormalized fact table for DCMP registration.
-- FK resolution only: project_name, client_name, tag_names, dim category attrs.
-- No gap filling. No synthetic rows. UUID stable via md5(time_entry_id).

with source_records as (
    select * from {{ ref('stg_toggl_track__time_entries') }}
    where stopped_at is not null  -- exclude in-progress entries
),

projects as (
    select project_id, project_name, project_color, client_name
    from {{ ref('dim_time_projects') }}
),

tags as (
    select tag_id, tag_name
    from {{ ref('stg_toggl_track__tags') }}
),

dim_personal_colors as (
    select
        dp.name as personal_category,
        dp.coarse_category,
        unnest(dp.color_hex_codes) as toggl_color_hex
    from {{ ref('dim_category_time_personal') }} dp
),

dim_social_clients as (
    select
        ds.name as social_category,
        unnest(ds.client_names) as client_name
    from {{ ref('dim_category_time_social') }} ds
),

tag_names_agg as (
    select
        sr.time_entry_id,
        array_agg(t.tag_name order by t.tag_name) filter (where t.tag_name is not null) as tag_names
    from source_records sr
    cross join lateral unnest(sr.tag_ids) as tid(tag_id)
    left join tags t on t.tag_id = tid.tag_id
    group by sr.time_entry_id
)

select
    md5(sr.time_entry_id::text)::uuid as id,
    sr.time_entry_id::text as source_id,
    sr.started_at,
    sr.stopped_at,
    sr.duration_seconds,
    sr.description,
    sr.project_id,
    p.project_name,
    p.project_color,
    p.client_name,
    coalesce(tn.tag_names, array[]::text[]) as tag_names,
    coalesce(dpc.personal_category, 'Uncategorized') as personal_category,
    coalesce(dpc.coarse_category, 'Uncategorized') as coarse_personal_category,
    coalesce(dsc.social_category, 'UNKNOWN') as social_category,
    sr.updated_at,
    sr.synced_at
from source_records sr
left join projects p on p.project_id = sr.project_id
left join tag_names_agg tn on tn.time_entry_id = sr.time_entry_id
left join dim_personal_colors dpc on dpc.toggl_color_hex = p.project_color
left join dim_social_clients dsc on dsc.client_name = p.client_name
