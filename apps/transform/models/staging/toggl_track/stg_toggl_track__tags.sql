with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__tags_current') }}
),

staged as (
    select
        source_id::bigint as tag_id,
        (data->>'workspace_id')::bigint as workspace_id,
        data->>'name' as tag_name,
        (data->>'at')::timestamptz as created_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
