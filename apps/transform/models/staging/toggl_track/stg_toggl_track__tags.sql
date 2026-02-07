with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__tags') }}
),

staged as (
    select
        id,
        source_id::bigint as tag_id,
        (data->>'workspace_id')::bigint as workspace_id,
        data->>'name' as tag_name,
        (data->>'at')::timestamptz as created_at,
        synced_at,
        api_version
    from source
)

select * from staged
