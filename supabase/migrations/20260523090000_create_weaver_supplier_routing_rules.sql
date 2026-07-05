create extension if not exists pg_trgm with schema public;

create table if not exists public.weaver_overseas_supplier_routing_rules (
  id uuid primary key default gen_random_uuid(),

  supplier_name text not null,
  product_family text not null,
  match_scope text not null,
  match_terms text[] not null default '{}'::text[],
  exclude_terms text[] not null default '{}'::text[],
  priority_rank integer not null default 100 check (priority_rank >= 1),
  routing_note text,

  source_type text not null default 'manual',
  source_mapping_id uuid references public.weaver_overseas_supplier_mapping(id) on delete set null,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint weaver_overseas_supplier_routing_rules_match_scope_chk check (
    match_scope in ('item', 'category', 'material', 'service')
  ),
  constraint weaver_overseas_supplier_routing_rules_source_type_chk check (
    source_type in ('manual', 'mapping_import')
  ),
  constraint weaver_overseas_supplier_routing_rules_match_terms_chk check (
    cardinality(match_terms) > 0
  )
);

create index if not exists idx_weaver_overseas_supplier_routing_active
  on public.weaver_overseas_supplier_routing_rules
  (is_active, priority_rank, match_scope, product_family);

create index if not exists idx_weaver_overseas_supplier_routing_supplier
  on public.weaver_overseas_supplier_routing_rules
  (lower(supplier_name));

create index if not exists idx_weaver_overseas_supplier_routing_match_terms
  on public.weaver_overseas_supplier_routing_rules using gin (match_terms);

create index if not exists idx_weaver_overseas_supplier_routing_exclude_terms
  on public.weaver_overseas_supplier_routing_rules using gin (exclude_terms);

create index if not exists idx_weaver_overseas_supplier_routing_family_trgm
  on public.weaver_overseas_supplier_routing_rules
  using gin (lower(product_family) gin_trgm_ops);

create unique index if not exists uq_weaver_overseas_supplier_routing_active_rule
  on public.weaver_overseas_supplier_routing_rules (
    lower(supplier_name),
    lower(product_family),
    match_scope,
    priority_rank
  )
  where is_active = true;

with seed_rows (
  supplier_name,
  product_family,
  match_scope,
  match_terms,
  exclude_terms,
  priority_rank,
  routing_note
) as (
  values
    (
      '小刘',
      'Shipping and logistics',
      'service',
      array[
        'shipping',
        'shipper',
        'shipment',
        'logistics',
        'freight',
        'air freight',
        'sea freight',
        'china shipping',
        'delivery from china',
        'courier',
        'forwarder'
      ]::text[],
      array[]::text[],
      5,
      'Use 小刘 for shipping, freight, forwarding, and logistics questions.'
    ),
    (
      'Mandy Jasmine',
      'Umbrellas',
      'category',
      array['umbrella', 'umbrellas', 'foldable umbrella', 'golf umbrella', 'auto umbrella']::text[],
      array[]::text[],
      5,
      'Mandy Jasmine runs the umbrella factory.'
    ),
    (
      'David Peng',
      'PVC products',
      'material',
      array[
        'pvc',
        'pvc pouch',
        'pvc folder',
        'pvc file',
        'pvc transparent pouch',
        'pvc luggage tag',
        'l-shape file',
        'l shape file',
        'a4 l shape file'
      ]::text[],
      array[]::text[],
      5,
      'David Peng runs the PVC factory; use him for PVC-material enquiries.'
    ),
    (
      'Bella',
      'Pens and pen boxes',
      'category',
      array[
        'pen',
        'pens',
        'plastic pen',
        'plastic pens',
        'metal pen',
        'metal pens',
        'eco pen',
        'eco pens',
        'ball pen',
        'ballpoint pen',
        'gel pen',
        'pen box',
        'pen boxes'
      ]::text[],
      array[]::text[],
      5,
      'Bella is first priority for pen and pen box enquiries.'
    ),
    (
      'Stephen',
      'Pens and pen boxes',
      'category',
      array[
        'pen',
        'pens',
        'plastic pen',
        'plastic pens',
        'metal pen',
        'metal pens',
        'eco pen',
        'eco pens',
        'ball pen',
        'ballpoint pen',
        'gel pen',
        'pen box',
        'pen boxes'
      ]::text[],
      array[]::text[],
      20,
      'Stephen is the fallback pen and pen box supplier behind Bella.'
    ),
    (
      '真诚彩印包装',
      'Boxes',
      'category',
      array['box', 'boxes', 'packaging box', 'gift box', 'paper box', 'custom box', 'rigid box', 'folding box']::text[],
      array['cake box', 'cake boxes', 'pen box', 'pen boxes']::text[],
      30,
      'Use 真诚彩印包装 for generic box enquiries after more specific box suppliers are considered.'
    ),
    (
      'Grace',
      'Cake boxes',
      'category',
      array['cake box', 'cake boxes', 'cake packaging', 'bakery box', 'bakery boxes']::text[],
      array[]::text[],
      5,
      'Grace is first priority for cake box enquiries.'
    ),
    (
      'Nikki',
      'Scratch cards',
      'item',
      array['scratch card', 'scratch cards', 'scratchcard', 'scratch off card', 'scratch-off card']::text[],
      array[]::text[],
      5,
      'Nikki runs the scratch card factory.'
    ),
    (
      'Nancy',
      'Lanyards',
      'category',
      array[
        'lanyard',
        'lanyards',
        'woven lanyard',
        'polyester lanyard',
        'badge lanyard',
        'id lanyard',
        'lanyard strap'
      ]::text[],
      array[]::text[],
      5,
      'Nancy is first priority for anything remotely lanyard related.'
    ),
    (
      'Nancy',
      'Card holders',
      'category',
      array[
        'card holder',
        'card holders',
        'card case',
        'card cases',
        'id holder',
        'id card holder',
        'card sleeve',
        'badge holder',
        'card organizer',
        'pull out card case',
        'pull-out card case'
      ]::text[],
      array[]::text[],
      5,
      'Nancy is first priority for card holder and card case enquiries.'
    ),
    (
      'Carrie',
      'Electronics and gadgets',
      'category',
      array[
        'electronics',
        'electronic',
        'gadget',
        'gadgets',
        'speaker',
        'speakers',
        'earphone',
        'earphones',
        'headphone',
        'headphones',
        'mouse',
        'wireless mouse',
        'usb',
        'usb drive',
        'thumb drive',
        'travel adapter',
        'adapter',
        'webcam cover',
        'fan',
        'portable fan',
        'power bank',
        'wireless charger'
      ]::text[],
      array['hand fan', 'paper fan']::text[],
      10,
      'Carrie runs the electronics company; use for electronics and gadgets.'
    ),
    (
      'Kerry',
      'Notebooks',
      'category',
      array['notebook', 'notebooks', 'wire-o notebook', 'wire o notebook', 'premium notebook', 'journal', 'planner', 'diary']::text[],
      array[]::text[],
      5,
      'Kerry runs the notebook factory.'
    ),
    (
      'Joyce',
      'Stickers decals and post-it pads',
      'category',
      array[
        'sticker',
        'stickers',
        'decal',
        'decals',
        'static decal',
        'car decal',
        'hologram sticker',
        'post it',
        'post-it',
        'post it pad',
        'post-it pad',
        'memo pad',
        'sticky note',
        'sticky notes'
      ]::text[],
      array[]::text[],
      5,
      'Joyce is first priority for decal, sticker, and post-it pad enquiries.'
    ),
    (
      'Seven',
      'Decals',
      'category',
      array['decal', 'decals', 'static decal', 'car decal']::text[],
      array[]::text[],
      20,
      'Seven is the fallback decal supplier behind Joyce.'
    ),
    (
      'kathy',
      'Drinkware',
      'category',
      array[
        'drinkware',
        'bottle',
        'bottles',
        'tumbler',
        'tumblers',
        'mug',
        'mugs',
        'cup',
        'cups',
        'vacuum flask',
        'vacuum flasks',
        'flask',
        'flasks',
        'thermos',
        'water bottle',
        'sports bottle',
        'travel mug'
      ]::text[],
      array[]::text[],
      5,
      'kathy is first priority for drinkware.'
    ),
    (
      'KG Lammi',
      'Drinkware',
      'category',
      array[
        'drinkware',
        'bottle',
        'bottles',
        'tumbler',
        'tumblers',
        'mug',
        'mugs',
        'cup',
        'cups',
        'vacuum flask',
        'vacuum flasks',
        'flask',
        'flasks',
        'thermos',
        'water bottle',
        'sports bottle',
        'travel mug'
      ]::text[],
      array[]::text[],
      20,
      'KG Lammi is a fallback drinkware supplier behind kathy.'
    ),
    (
      'Zhou',
      'Bags',
      'category',
      array[
        'bag',
        'bags',
        'tote',
        'tote bag',
        'tote bags',
        'cotton bag',
        'canvas bag',
        'cotton canvas bag',
        'non woven bag',
        'non-woven bag',
        'jute bag',
        'cooler bag',
        'nylon bag',
        'backpack',
        'backpacks',
        'drawstring bag',
        'shopping bag',
        'recycle bag'
      ]::text[],
      array['paper bag', 'paper bags']::text[],
      10,
      'Zhou runs the tote/bag factory; Huang Xu is preferred for paper bags.'
    ),
    (
      'Yun',
      'Wristbands',
      'category',
      array['wristband', 'wristbands', 'silicone wristband', 'tyvek wristband', 'slap wristband', 'polyester wristband', 'fabric wristband']::text[],
      array[]::text[],
      5,
      'Yun is first priority for wristbands.'
    ),
    (
      'Yun',
      'Enamel products',
      'category',
      array['enamel', 'enamel pin', 'enamel pins', 'enamel badge', 'enamel badges', 'enamel keychain']::text[],
      array[]::text[],
      5,
      'Yun is first priority for enamel products.'
    ),
    (
      'Yun',
      'Acrylic products',
      'category',
      array['acrylic', 'acrylic keychain', 'acrylic keychains', 'acrylic standee', 'acrylic badge']::text[],
      array[]::text[],
      5,
      'Yun is first priority for acrylic products.'
    ),
    (
      'Lucy',
      'Disposable masks',
      'category',
      array['disposable mask', 'disposable masks', 'face mask disposable', 'surgical mask', 'surgical masks', 'medical mask', 'medical masks']::text[],
      array[]::text[],
      5,
      'Lucy runs the disposable mask factory.'
    ),
    (
      '鑫芳秋反光衣工厂',
      'Safety vests and safety products',
      'category',
      array[
        'safety vest',
        'safety vests',
        'reflective vest',
        'reflective vests',
        'hi vis vest',
        'hi-vis vest',
        'safety',
        'safety wear',
        'safety jacket',
        'reflective clothing'
      ]::text[],
      array[]::text[],
      5,
      '鑫芳秋反光衣工厂 is first priority for safety vest and safety-related enquiries.'
    ),
    (
      'Amy',
      'Embroidery patches',
      'category',
      array['embroidery patch', 'embroidery patches', 'embroidered patch', 'embroidered patches', 'embroidery item', 'embroidery items', 'patch', 'patches']::text[],
      array[]::text[],
      5,
      'Amy runs the embroidery patch factory.'
    ),
    (
      'Huang Xu',
      'Paper bags and folders',
      'category',
      array['paper bag', 'paper bags', 'kraft bag', 'kraft paper bag', 'paper folder', 'paper folders', 'presentation folder', 'folders']::text[],
      array[]::text[],
      5,
      'Huang Xu is first priority for paper bags and paper folders.'
    ),
    (
      'Mary Jarmoo',
      'Mouse pads',
      'category',
      array['mouse pad', 'mouse pads', 'mousepad', 'mousepads']::text[],
      array[]::text[],
      5,
      'Mary Jarmoo runs the mouse pad factory.'
    ),
    (
      'Apple',
      'Stress balls',
      'category',
      array['stress ball', 'stress balls', 'stressball', 'stressballs']::text[],
      array[]::text[],
      5,
      'Apple is first priority for stress ball enquiries.'
    ),
    (
      'Lavi Vicky',
      'Medals',
      'category',
      array['medal', 'medals', 'award medal', 'award medals', 'sports medal', 'custom medal']::text[],
      array[]::text[],
      5,
      'Lavi Vicky runs the medal factory.'
    )
)
insert into public.weaver_overseas_supplier_routing_rules (
  supplier_name,
  product_family,
  match_scope,
  match_terms,
  exclude_terms,
  priority_rank,
  routing_note,
  source_type
)
select
  seed_rows.supplier_name,
  seed_rows.product_family,
  seed_rows.match_scope,
  seed_rows.match_terms,
  seed_rows.exclude_terms,
  seed_rows.priority_rank,
  seed_rows.routing_note,
  'manual'
from seed_rows
where not exists (
  select 1
  from public.weaver_overseas_supplier_routing_rules existing
  where existing.is_active = true
    and lower(existing.supplier_name) = lower(seed_rows.supplier_name)
    and lower(existing.product_family) = lower(seed_rows.product_family)
    and existing.match_scope = seed_rows.match_scope
    and existing.priority_rank = seed_rows.priority_rank
);

insert into public.weaver_overseas_supplier_routing_rules (
  supplier_name,
  product_family,
  match_scope,
  match_terms,
  priority_rank,
  routing_note,
  source_type,
  source_mapping_id
)
select
  mapping.supplier_name,
  mapping.item_name,
  'item',
  array_remove(array[mapping.item_name, mapping.usual_name], null),
  80,
  'Fallback exact-item route imported from weaver_overseas_supplier_mapping.',
  'mapping_import',
  mapping.id
from public.weaver_overseas_supplier_mapping mapping
where mapping.is_active = true
  and not exists (
    select 1
    from public.weaver_overseas_supplier_routing_rules existing
    where existing.source_mapping_id = mapping.id
  );

create or replace function public.weaver_normalize_supplier_text(value text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(value, '')), '[^[:alnum:]]+', ' ', 'g'));
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
        cross join lateral (
          select
            lower(terms.term) as raw_term,
            public.weaver_normalize_supplier_text(terms.term) as normalized_term
        ) normalized_terms
        where normalized_terms.normalized_term <> ''
          and (
            position(' ' || normalized_terms.normalized_term || ' ' in ' ' || input_text.normalized_query || ' ') > 0
            or position(' ' || normalized_terms.normalized_term || 's ' in ' ' || input_text.normalized_query || ' ') > 0
            or position(' ' || normalized_terms.normalized_term || 'es ' in ' ' || input_text.normalized_query || ' ') > 0
            or (
              length(normalized_terms.normalized_term) >= 4
              and position(normalized_terms.normalized_term in input_text.normalized_query) > 0
            )
            or (
              normalized_terms.raw_term ~ '[^[:ascii:]]'
              and position(normalized_terms.raw_term in input_text.raw_query) > 0
            )
            or (
              length(normalized_terms.normalized_term) >= 4
              and word_similarity(normalized_terms.normalized_term, input_text.normalized_query) >= 0.82
            )
          )
      ) term_matches
    ) matches
    cross join lateral (
      select coalesce(array_agg(distinct exclude_matches.term order by exclude_matches.term), '{}'::text[]) as excluded_terms
      from (
        select terms.term
        from unnest(active_rules.exclude_terms) as terms(term)
        cross join lateral (
          select
            lower(terms.term) as raw_term,
            public.weaver_normalize_supplier_text(terms.term) as normalized_term
        ) normalized_terms
        where normalized_terms.normalized_term <> ''
          and (
            position(' ' || normalized_terms.normalized_term || ' ' in ' ' || input_text.normalized_query || ' ') > 0
            or position(' ' || normalized_terms.normalized_term || 's ' in ' ' || input_text.normalized_query || ' ') > 0
            or position(' ' || normalized_terms.normalized_term || 'es ' in ' ' || input_text.normalized_query || ' ') > 0
            or (
              length(normalized_terms.normalized_term) >= 4
              and position(normalized_terms.normalized_term in input_text.normalized_query) > 0
            )
            or (
              normalized_terms.raw_term ~ '[^[:ascii:]]'
              and position(normalized_terms.raw_term in input_text.raw_query) > 0
            )
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

alter table public.weaver_overseas_supplier_routing_rules enable row level security;
