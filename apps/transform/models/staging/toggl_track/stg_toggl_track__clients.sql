with source as (
    select * from {{ ref('raw_toggl_track__clients_current') }}
),

staged as (
    select
        source_id::bigint as client_id,
        (data->>'wid')::bigint as workspace_id,
        data->>'name' as client_name,
        coalesce((data->>'archived')::boolean, false) as is_archived,
        (data->>'at')::timestamptz as created_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
