-- stg_zaim__money.sql
-- =============================================================================
-- Zaim money (transactions) staging model
-- Source: data_warehouse.raw_zaim__money (Zaim API v2)
--
-- Transaction types (mode):
-- - income: 収入
-- - payment: 支出
-- - transfer: 振替
--
-- Note: source_id (Zaim money id) でユニーク化
-- =============================================================================

with source as (
    select * from {{ source('raw_zaim', 'raw_zaim__money') }}
),

staged as (
    select
        id,
        source_id,
        (data->>'id')::bigint as zaim_id,
        (data->>'user_id')::bigint as user_id,
        data->>'mode' as mode,
        (data->>'date')::date as transaction_date,
        (data->>'created')::timestamptz as created_at,
        (data->>'amount')::integer as amount,
        (data->>'category_id')::integer as category_id,
        (data->>'genre_id')::integer as genre_id,
        (data->>'from_account_id')::integer as from_account_id,
        (data->>'to_account_id')::integer as to_account_id,
        data->>'name' as name,
        data->>'place' as place,
        data->>'comment' as comment,
        (data->>'receipt_id')::bigint as receipt_id,
        coalesce(data->>'currency_code', 'JPY') as currency_code,
        (data->>'active')::integer = 1 as is_active,
        synced_at,
        api_version
    from source
)

select * from staged
