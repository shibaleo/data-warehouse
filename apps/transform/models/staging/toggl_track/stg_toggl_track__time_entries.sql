-- stg_toggl_track__time_entries.sql
-- Unified from Track API v9 + Reports API v3
-- Priority: report > track (for same time_entry_id)

with tags as (
    select tag_name, tag_id
    from {{ ref('stg_toggl_track__tags') }}
),

projects as (
    select project_id, workspace_id
    from {{ ref('stg_toggl_track__projects') }}
),

-- Source 1: Reports API v3 (Primary)
report_source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__time_entries_report') }}
),

report_entries as (
    select
        rs.source_id::bigint as time_entry_id,
        p.workspace_id,
        (rs.data->>'project_id')::bigint as project_id,
        (rs.data->>'task_id')::bigint as task_id,
        (rs.data->>'user_id')::bigint as user_id,
        rs.data->>'description' as description,
        (rs.data->>'billable')::boolean as is_billable,
        case
            when rs.data->'tag_ids' is not null and jsonb_typeof(rs.data->'tag_ids') = 'array'
            then array(select (jsonb_array_elements_text(rs.data->'tag_ids'))::bigint)
            else array[]::bigint[]
        end as tag_ids,
        (rs.data->>'start')::timestamptz as started_at,
        (rs.data->>'stop')::timestamptz as stopped_at,
        (rs.data->>'seconds')::bigint as duration_seconds,
        null::boolean as is_running,
        (rs.data->>'at')::timestamptz as updated_at,
        rs.synced_at,
        rs.api_version,
        'report' as data_source
    from report_source rs
    left join projects p on p.project_id = (rs.data->>'project_id')::bigint
),

-- Source 2: Track API v9
track_source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__time_entries') }}
),

track_entries_with_tag_names as (
    select
        source_id::bigint as time_entry_id,
        (data->>'workspace_id')::bigint as workspace_id,
        (data->>'project_id')::bigint as project_id,
        (data->>'task_id')::bigint as task_id,
        (data->>'user_id')::bigint as user_id,
        data->>'description' as description,
        (data->>'billable')::boolean as is_billable,
        case
            when data->'tags' is not null and jsonb_typeof(data->'tags') = 'array'
            then array(select jsonb_array_elements_text(data->'tags'))
            else array[]::text[]
        end as tag_names,
        (data->>'start')::timestamptz as started_at,
        (data->>'stop')::timestamptz as stopped_at,
        case
            when (data->>'duration')::bigint < 0 then null
            else (data->>'duration')::bigint
        end as duration_seconds,
        (data->>'duration')::bigint < 0 as is_running,
        (data->>'at')::timestamptz as updated_at,
        synced_at,
        api_version
    from track_source
),

track_entries as (
    select
        te.time_entry_id, te.workspace_id, te.project_id, te.task_id, te.user_id,
        te.description, te.is_billable,
        coalesce(
            array_agg(t.tag_id) filter (where t.tag_id is not null),
            array[]::bigint[]
        ) as tag_ids,
        te.started_at, te.stopped_at, te.duration_seconds, te.is_running,
        te.updated_at, te.synced_at, te.api_version,
        'track' as data_source
    from track_entries_with_tag_names te
    left join lateral unnest(te.tag_names) as tn(name) on true
    left join tags t on t.tag_name = tn.name
    group by
        te.time_entry_id, te.workspace_id, te.project_id, te.task_id, te.user_id,
        te.description, te.is_billable, te.started_at, te.stopped_at,
        te.duration_seconds, te.is_running, te.updated_at, te.synced_at, te.api_version
),

all_entries as (
    select * from report_entries
    union all
    select * from track_entries
),

deduplicated as (
    select
        *,
        row_number() over (
            partition by time_entry_id
            order by
                case when data_source = 'report' then 0 else 1 end,
                synced_at desc
        ) as rn
    from all_entries
)

select
    time_entry_id, workspace_id, project_id, task_id, user_id,
    description, is_billable, tag_ids, started_at, stopped_at,
    duration_seconds, is_running, updated_at, synced_at, api_version, data_source
from deduplicated
where rn = 1
