-- dim_time_projects.sql
-- Toggl projects dimension (Coda dependency removed)

with toggl_projects as (
    select
        project_id,
        project_name,
        color as project_color,
        client_id,
        is_active,
        is_private,
        is_billable,
        created_at,
        updated_at
    from {{ ref('stg_toggl_track__projects') }}
),

toggl_clients as (
    select client_id, client_name
    from {{ ref('stg_toggl_track__clients') }}
)

select
    tp.project_id,
    tp.project_name,
    tp.project_color,
    tp.client_id,
    tc.client_name,
    tp.is_active,
    tp.is_private,
    tp.is_billable,
    tp.created_at,
    tp.updated_at
from toggl_projects tp
left join toggl_clients tc on tc.client_id = tp.client_id
