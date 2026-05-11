{# wrap_dim -- canonical (biz=now, tx=now) projection of a Pattern 2 dim table.

Calls data_warehouse_v2.<table_name>_at() under the hood and applies the
standard active-row filter. The function must already exist (created by
`CALL data_warehouse_v2.create_dim_at_function('<table_name>')` in the
table's migration).

For time-travel queries, call the underlying function directly:
  SELECT * FROM data_warehouse_v2.<table>_at(biz_t, tx_t)
  WHERE deleted = false AND purged = false;

Usage in a wrapper model:
  {{ wrap_dim('example_dim') }}

The model file's name determines the resulting view name; e.g.
example_dim_current.sql produces data_warehouse_v2.example_dim_current.
#}
{% macro wrap_dim(table_name) -%}
select * from data_warehouse_v2.{{ table_name }}_at()
where deleted = false and purged = false
{%- endmacro %}
