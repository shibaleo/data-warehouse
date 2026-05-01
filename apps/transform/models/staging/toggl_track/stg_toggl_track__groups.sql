with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__groups_current') }}
),

staged as (
    select
        source_id::bigint as group_id,
        (data->>'workspace_id')::bigint as workspace_id,
        data->>'name' as group_name,
        (data->>'at')::timestamptz as updated_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
