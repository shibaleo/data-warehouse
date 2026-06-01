{# google_health_civil_date — convert a Google Health civil date JSONB
   object `{year, month, day}` to a PostgreSQL date.

   Usage:
     {{ google_health_civil_date("data->'dailyRestingHeartRate'->'date'") }}

   The macro emits a make_date(...) expression; pass the JSONB path that
   points at the date object.
#}
{% macro google_health_civil_date(json_path) -%}
make_date(
    ({{ json_path }}->>'year')::int,
    ({{ json_path }}->>'month')::int,
    ({{ json_path }}->>'day')::int
)
{%- endmacro %}
