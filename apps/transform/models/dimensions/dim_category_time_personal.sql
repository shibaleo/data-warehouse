-- dim_category_time_personal.sql
-- Personal time categories with Toggl color mapping (seed CSV based)

with personal_categories as (
    select
        name,
        name_ja,
        description,
        coarse_category,
        sort_order
    from {{ ref('seed_category_time_personal') }}
),

color_mapping as (
    select
        toggl_color_hex,
        toggl_color_name,
        time_category_personal
    from {{ ref('seed_toggl_color_to_personal') }}
)

select
    pc.name,
    pc.name_ja,
    pc.description,
    pc.coarse_category,
    pc.sort_order,
    array_agg(distinct cm.toggl_color_hex order by cm.toggl_color_hex) filter (where cm.toggl_color_hex is not null) as color_hex_codes,
    array_agg(distinct cm.toggl_color_name order by cm.toggl_color_name) filter (where cm.toggl_color_name is not null) as color_names
from personal_categories pc
left join color_mapping cm on cm.time_category_personal = pc.name
group by pc.name, pc.name_ja, pc.description, pc.coarse_category, pc.sort_order
order by pc.sort_order
