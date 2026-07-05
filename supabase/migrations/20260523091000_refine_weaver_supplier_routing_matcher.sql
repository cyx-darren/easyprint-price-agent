create or replace function public.weaver_supplier_term_matches(
  term text,
  raw_query text,
  normalized_query text,
  use_fuzzy boolean default false
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select normalized_terms.normalized_term <> ''
    and (
      position(' ' || normalized_terms.normalized_term || ' ' in ' ' || coalesce(normalized_query, '') || ' ') > 0
      or position(' ' || normalized_terms.normalized_term || 's ' in ' ' || coalesce(normalized_query, '') || ' ') > 0
      or position(' ' || normalized_terms.normalized_term || 'es ' in ' ' || coalesce(normalized_query, '') || ' ') > 0
      or (
        length(normalized_terms.normalized_term) >= 4
        and position(normalized_terms.normalized_term in coalesce(normalized_query, '')) > 0
      )
      or (
        normalized_terms.raw_term ~ '[^[:ascii:]]'
        and position(normalized_terms.raw_term in coalesce(raw_query, '')) > 0
      )
      or (
        use_fuzzy
        and length(normalized_terms.normalized_term) >= 4
        and word_similarity(normalized_terms.normalized_term, coalesce(normalized_query, '')) >= 0.82
      )
    )
  from (
    select
      lower(coalesce(term, '')) as raw_term,
      public.weaver_normalize_supplier_text(term) as normalized_term
  ) normalized_terms;
$$;

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
      exclusions.excluded_terms
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
  )
  select
    matched_rules.supplier_name,
    matched_rules.product_family,
    matched_rules.match_scope,
    matched_rules.matched_terms,
    matched_rules.priority_rank,
    matched_rules.routing_note,
    contact.wechat_id,
    contact.group_chat_name,
    contact.remarks as supplier_remarks,
    contact.item_name as source_item_name,
    contact.usual_name as source_usual_name,
    matched_rules.id as routing_rule_id,
    contact.id as supplier_mapping_id
  from matched_rules
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
      and lower(mapping.supplier_name) = lower(matched_rules.supplier_name)
    order by
      case when matched_rules.source_mapping_id is not null and mapping.id = matched_rules.source_mapping_id then 0 else 1 end,
      case when mapping.wechat_id is not null then 0 else 1 end,
      mapping.source_row_number
    limit 1
  ) contact on true
  order by
    matched_rules.priority_rank,
    case matched_rules.match_scope
      when 'item' then 1
      when 'service' then 2
      when 'material' then 3
      when 'category' then 4
      else 5
    end,
    cardinality(matched_rules.matched_terms) desc,
    matched_rules.product_family,
    matched_rules.supplier_name
  limit greatest(coalesce(max_results, 10), 0);
$$;
