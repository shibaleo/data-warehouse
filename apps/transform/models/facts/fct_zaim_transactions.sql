-- fct_zaim_transactions.sql
-- Zaim transaction fact with category/genre/account names
-- One row per active transaction

with money as (
    select * from {{ ref('stg_zaim__money') }}
    where is_active = true
),

categories as (
    select category_id, name as category_name, mode as category_mode
    from {{ ref('stg_zaim__category') }}
),

genres as (
    select genre_id, name as genre_name, category_id
    from {{ ref('stg_zaim__genre') }}
),

accounts as (
    select account_id, name as account_name
    from {{ ref('stg_zaim__account') }}
)

select
    m.id,
    m.source_id,
    m.zaim_id,
    m.mode,
    m.transaction_date,
    m.amount,
    m.category_id,
    c.category_name,
    m.genre_id,
    g.genre_name,
    m.from_account_id,
    fa.account_name as from_account_name,
    m.to_account_id,
    ta.account_name as to_account_name,
    m.name as item_name,
    m.place,
    m.comment,
    m.currency_code,
    m.created_at,
    m.synced_at
from money m
left join categories c on c.category_id = m.category_id
left join genres g on g.genre_id = m.genre_id
left join accounts fa on fa.account_id = m.from_account_id
left join accounts ta on ta.account_id = m.to_account_id
