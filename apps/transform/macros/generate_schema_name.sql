{% macro generate_schema_name(custom_schema_name, node) -%}
    {# All models go to the same schema (data_warehouse). No custom schema prefix. #}
    {{ target.schema }}
{%- endmacro %}
