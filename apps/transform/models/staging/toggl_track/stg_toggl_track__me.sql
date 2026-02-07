with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__me') }}
)

select
    id,
    source_id::bigint as user_id,
    data->>'email' as email,
    data->>'fullname' as full_name,
    data->>'timezone' as timezone,
    (data->>'default_workspace_id')::bigint as default_workspace_id,
    data->>'image_url' as image_url,
    (data->>'beginning_of_week')::int as beginning_of_week,
    data->>'country_id' as country_id,
    (data->>'created_at')::timestamptz as created_at,
    (data->>'at')::timestamptz as updated_at,
    synced_at,
    api_version
from source
