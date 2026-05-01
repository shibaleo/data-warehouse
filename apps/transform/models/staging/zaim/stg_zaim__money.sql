-- stg_zaim__money.sql
-- Source: raw_zaim__money_current (data_warehouse_v2, append-only).
--
-- Naming caveat: the v2 base column `created_at` is the row-level
-- "first observed" timestamp; we expose it here as `synced_at` for
-- backward compat with downstream consumers. The `created_at` output
-- column comes from Zaim's `data->>'created'` (transaction creation
-- time) — a different concept entirely. The explicit `s.` alias on
-- the synced_at line keeps PostgreSQL from confusing the two.

with source as (
    select * from {{ source('raw_zaim', 'raw_zaim__money_current') }}
),

staged as (
    select
        s.source_id,
        (s.data->>'id')::bigint as zaim_id,
        (s.data->>'user_id')::bigint as user_id,
        s.data->>'mode' as mode,
        (s.data->>'date')::date as transaction_date,
        (s.data->>'created')::timestamptz as created_at,
        (s.data->>'amount')::integer as amount,
        (s.data->>'category_id')::integer as category_id,
        (s.data->>'genre_id')::integer as genre_id,
        (s.data->>'from_account_id')::integer as from_account_id,
        (s.data->>'to_account_id')::integer as to_account_id,
        s.data->>'name' as name,
        s.data->>'place' as place,
        s.data->>'comment' as comment,
        (s.data->>'receipt_id')::bigint as receipt_id,
        coalesce(s.data->>'currency_code', 'JPY') as currency_code,
        (s.data->>'active')::integer = 1 as is_active,
        s.created_at as synced_at,
        s.api_version
    from source s
)

select * from staged
