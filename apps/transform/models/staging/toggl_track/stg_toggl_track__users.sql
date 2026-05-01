with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__users_current') }}
),

staged as (
    select
        source_id::bigint as user_id,
        data->>'email' as email,
        data->>'fullname' as full_name,
        data->>'timezone' as timezone,
        (data->>'admin')::boolean as is_admin,
        (data->>'active')::boolean as is_active,
        (data->>'at')::timestamptz as updated_at,
        created_at as synced_at,
        api_version
    from source
)

select * from staged
