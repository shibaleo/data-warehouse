{# wrap_raw -- canonical projection of a v2 raw table to its "current" view.

Calls data_warehouse_v2.raw_at(table) under the hood and applies the
standard active-row filter. The `-- depends_on` comment tells dbt to
treat the matching source as an upstream dependency for lineage, even
though the compiled SQL doesn't reference the source directly (it goes
through the function instead).

Usage in a wrapper model:
  {{ wrap_raw('raw_zaim', 'raw_zaim__money') }}

The generated view's name comes from the model file name, so a file
called raw_zaim__money_current.sql produces the data_warehouse_v2
.raw_zaim__money_current view.
#}
{% macro wrap_raw(source_name, table_name) -%}
-- depends_on: {{ source(source_name, table_name) }}
select * from data_warehouse_v2.raw_at('{{ table_name }}')
where deleted = false and purged = false
{%- endmacro %}
