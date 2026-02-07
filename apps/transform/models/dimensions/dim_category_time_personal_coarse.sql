-- dim_category_time_personal_coarse.sql
-- Coarse personal time categories (seed CSV based)

select
    name,
    sort_order
from {{ ref('seed_category_time_personal_coarse') }}
