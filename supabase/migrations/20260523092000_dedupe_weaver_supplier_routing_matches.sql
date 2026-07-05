update public.weaver_overseas_supplier_routing_rules
set
  exclude_terms = array['cake box', 'cake boxes', 'pen box', 'pen boxes'],
  updated_at = now()
where source_type = 'mapping_import'
  and lower(supplier_name) = lower('真诚彩印包装')
  and lower(product_family) = 'box';

update public.weaver_overseas_supplier_routing_rules
set
  exclude_terms = array['hand fan', 'paper fan'],
  updated_at = now()
where source_type = 'mapping_import'
  and lower(supplier_name) = lower('Carrie')
  and lower(product_family) = 'fan';

create or replace function public.match_weaver_overseas_supplier(
  enquiry_text text,
  max_results integer default 10
)
returns table (
  supplier_name text,
  product_family text,
  match_scope text,
  matched_terms text[],
  priority_rank integer,
  routing_note text,
  wechat_id text,
  group_chat_name text,
  supplier_remarks text,
  source_item_name text,
  source_usual_name text,
  routing_rule_id uuid,
  supplier_mapping_id uuid
)
language sql
stable
set search_path = public
as $$
  with input_text as (
    select
      lower(coalesce(enquiry_text, '')) as raw_query,
      public.weaver_normalize_supplier_text(enquiry_text) as normalized_query
  ),
  active_rules as (
    select rules.*
    from public.weaver_overseas_supplier_routing_rules rules
    where rules.is_active = true
  ),
  matched_rules as (
    select
      active_rules.*,
      matches.matched_terms,
      exclusions.excluded_terms,
      case active_rules.match_scope
        when 'item' then 1
        when 'service' then 2
        when 'material' then 3
        when 'category' then 4
        else 5
      end as scope_rank
    from active_rules
    cross join input_text
    cross join lateral (
      select coalesce(array_agg(distinct term_matches.term order by term_matches.term), '{}'::text[]) as matched_terms
      from (
        select terms.term
        from unnest(active_rules.match_terms) as terms(term)
        where public.weaver_supplier_term_matches(
          terms.term,
          input_text.raw_query,
          input_text.normalized_query,
          true
        )
      ) term_matches
    ) matches
    cross join lateral (
      select coalesce(array_agg(distinct exclude_matches.term order by exclude_matches.term), '{}'::text[]) as excluded_terms
      from (
        select terms.term
        from unnest(active_rules.exclude_terms) as terms(term)
        where public.weaver_supplier_term_matches(
          terms.term,
          input_text.raw_query,
          input_text.normalized_query,
          false
        )
      ) exclude_matches
    ) exclusions
    where cardinality(matches.matched_terms) > 0
      and cardinality(exclusions.excluded_terms) = 0
  ),
  ranked_rules as (
    select distinct on (lower(matched_rules.supplier_name))
      matched_rules.*
    from matched_rules
    order by
      lower(matched_rules.supplier_name),
      matched_rules.priority_rank,
      matched_rules.scope_rank,
      cardinality(matched_rules.matched_terms) desc,
      matched_rules.product_family
  )
  select
    ranked_rules.supplier_name,
    ranked_rules.product_family,
    ranked_rules.match_scope,
    ranked_rules.matched_terms,
    ranked_rules.priority_rank,
    ranked_rules.routing_note,
    contact.wechat_id,
    contact.group_chat_name,
    contact.remarks as supplier_remarks,
    contact.item_name as source_item_name,
    contact.usual_name as source_usual_name,
    ranked_rules.id as routing_rule_id,
    contact.id as supplier_mapping_id
  from ranked_rules
  left join lateral (
    select
      mapping.id,
      mapping.item_name,
      mapping.usual_name,
      mapping.wechat_id,
      mapping.group_chat_name,
      mapping.remarks
    from public.weaver_overseas_supplier_mapping mapping
    where mapping.is_active = true
      and lower(mapping.supplier_name) = lower(ranked_rules.supplier_name)
    order by
      case when ranked_rules.source_mapping_id is not null and mapping.id = ranked_rules.source_mapping_id then 0 else 1 end,
      case when mapping.wechat_id is not null then 0 else 1 end,
      mapping.source_row_number
    limit 1
  ) contact on true
  order by
    ranked_rules.priority_rank,
    ranked_rules.scope_rank,
    cardinality(ranked_rules.matched_terms) desc,
    ranked_rules.product_family,
    ranked_rules.supplier_name
  limit greatest(coalesce(max_results, 10), 0);
$$;
