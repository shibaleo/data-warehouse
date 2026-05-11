with source as (
    select * from {{ ref('raw_toggl_track__projects_current') }}
),

staged as (
    select
        source_id::bigint as project_id,
        (data->>'workspace_id')::bigint as workspace_id,
        (data->>'client_id')::bigint as client_id,
        data->>'name' as project_name,
        data->>'color' as color,
        (data->>'is_private')::boolean as is_private,
        (data->>'active')::boolean as is_active,
        (data->>'billable')::boolean as is_billable,
        (data->>'created_at')::timestamptz as created_at,
        (data->>'at')::timestamptz as updated_at,
        (data->>'server_deleted_at')::timestamptz as archived_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
