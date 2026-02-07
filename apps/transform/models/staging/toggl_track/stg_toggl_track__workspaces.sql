with source as (
    select * from {{ source('raw_toggl_track', 'raw_toggl_track__workspaces') }}
),

staged as (
    select
        id,
        source_id::bigint as workspace_id,
        data->>'name' as workspace_name,
        (data->>'premium')::boolean as is_premium,
        (data->>'business_ws')::boolean as is_business,
        (data->>'default_hourly_rate')::numeric as default_hourly_rate,
        data->>'default_currency' as default_currency,
        (data->>'only_admins_may_create_projects')::boolean as only_admins_may_create_projects,
        (data->>'only_admins_see_billable_rates')::boolean as only_admins_see_billable_rates,
        (data->>'only_admins_see_team_dashboard')::boolean as only_admins_see_team_dashboard,
        (data->>'projects_billable_by_default')::boolean as projects_billable_by_default,
        (data->>'rounding')::integer as rounding,
        (data->>'rounding_minutes')::integer as rounding_minutes,
        (data->>'at')::timestamptz as updated_at,
        synced_at,
        api_version
    from source
)

select * from staged
