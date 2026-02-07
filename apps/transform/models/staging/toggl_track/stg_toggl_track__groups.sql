with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__groups') }}
)

select
    id,
    source_id::bigint as group_id,
    (data->>'workspace_id')::bigint as workspace_id,
    data->>'name' as group_name,
    (data->>'at')::timestamptz as updated_at,
    synced_at,
    api_version
from source
