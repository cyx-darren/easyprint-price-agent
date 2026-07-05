create index if not exists idx_weaver_overseas_supplier_routing_source_mapping
  on public.weaver_overseas_supplier_routing_rules (source_mapping_id)
  where source_mapping_id is not null;

create or replace function public.weaver_normalize_supplier_text(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(regexp_replace(lower(coalesce(value, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;
