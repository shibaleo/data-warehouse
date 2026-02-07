with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__clients') }}
)

select
    id,
    source_id::bigint as client_id,
    (data->>'wid')::bigint as workspace_id,
    data->>'name' as client_name,
    coalesce((data->>'archived')::boolean, false) as is_archived,
    (data->>'at')::timestamptz as created_at,
    synced_at,
    api_version
from source
