-- dim_category_time_social.sql
-- Social time categories with Toggl client mapping (seed CSV based)

with social_categories as (
    select
        name,
        name_ja,
        description,
        sort_order
    from {{ ref('seed_category_time_social') }}
),

client_mapping as (
    select
        toggl_client_name,
        time_category_social
    from {{ ref('seed_toggl_client_to_social') }}
),

toggl_clients as (
    select client_id, client_name
    from {{ ref('stg_toggl_track__clients') }}
)

select
    sc.name,
    sc.name_ja,
    sc.description,
    sc.sort_order,
    array_agg(distinct tc.client_name order by tc.client_name) filter (where tc.client_name is not null) as client_names
from social_categories sc
left join client_mapping cm on cm.time_category_social = sc.name
left join toggl_clients tc on tc.client_name = cm.toggl_client_name
group by sc.name, sc.name_ja, sc.description, sc.sort_order
order by sc.sort_order
