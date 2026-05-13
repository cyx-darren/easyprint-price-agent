create table if not exists public.orensport_products (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'ORENSPORT',
  item_series_code text not null,
  raw_item_series_code text not null,

  sizes text,
  agent_price numeric(10,2),
  price_4xl_5xl_7xl numeric(10,2),
  currency text not null default 'SGD',

  product_details text,
  remark text,
  price_update text,
  price_variant text not null default 'regular',

  page_ref text,
  source_pdf_page integer not null check (source_pdf_page >= 1),
  source_row_number integer not null check (source_row_number >= 1),
  source_row_key text not null unique,
  source_file text not null,
  effective_date date,

  category text,
  subcategory text,

  raw_row jsonb not null default '{}'::jsonb,

  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orensport_products_price_variant_chk check (price_variant in (
    'regular',
    'promotion',
    'wsl',
    'new',
    'new_sizes'
  ))
);

create index if not exists idx_orensport_products_item_series_code
  on public.orensport_products (item_series_code);

create index if not exists idx_orensport_products_raw_item_series_code
  on public.orensport_products (raw_item_series_code);

create index if not exists idx_orensport_products_price_variant
  on public.orensport_products (price_variant);

create index if not exists idx_orensport_products_category
  on public.orensport_products (category, subcategory);

alter table public.orensport_products enable row level security;
