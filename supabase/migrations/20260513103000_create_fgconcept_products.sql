create table if not exists public.fgconcept_product_scrape_runs (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'FGCONCEPT',
  source_url text not null default 'https://docs.google.com/spreadsheets/d/10tsMLZTUNoaB_dYYfhDfLMhLYQkoPjG_yAoVJ_soXBA/edit?gid=485920976#gid=485920976',
  run_type text not null,
  status text not null,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  series_count integer not null default 0 check (series_count >= 0),
  succeeded_series_count integer not null default 0 check (succeeded_series_count >= 0),
  failed_series_count integer not null default 0 check (failed_series_count >= 0),
  product_count integer not null default 0 check (product_count >= 0),

  failed_series text[] not null default '{}',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint fgconcept_product_scrape_runs_run_type_chk check (run_type in ('full', 'partial')),
  constraint fgconcept_product_scrape_runs_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create table if not exists public.fgconcept_products (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'FGCONCEPT',
  series_code text not null,
  item_code text not null,

  item_unit_price numeric(12,2),
  currency text not null default 'SGD',

  description text,
  image_url text,

  stock_status text,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),

  decoration_methods text[] not null default '{}',
  categories text,
  subcategories text,

  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_scraped_at timestamptz not null default now(),
  missing_since_at timestamptz,

  raw_product jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fgconcept_products_vendor_item_code_uq unique (vendor, item_code)
);

create table if not exists public.fgconcept_product_snapshots (
  id uuid primary key default gen_random_uuid(),

  scrape_run_id uuid not null references public.fgconcept_product_scrape_runs(id) on delete restrict,

  vendor text not null default 'FGCONCEPT',
  series_code text not null,
  item_code text not null,

  item_unit_price numeric(12,2),
  currency text not null default 'SGD',

  description text,
  image_url text,

  stock_status text,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),

  decoration_methods text[] not null default '{}',
  raw_product jsonb not null default '{}'::jsonb,

  scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint fgconcept_product_snapshots_run_item_uq unique (scrape_run_id, vendor, item_code)
);

create index if not exists idx_fgconcept_products_series_code
  on public.fgconcept_products (series_code);

create index if not exists idx_fgconcept_products_active
  on public.fgconcept_products (is_active, series_code, item_code);

create index if not exists idx_fgconcept_products_decoration_methods
  on public.fgconcept_products using gin (decoration_methods);

create index if not exists idx_fgconcept_product_snapshots_item_code
  on public.fgconcept_product_snapshots (vendor, item_code, scraped_at desc);

create index if not exists idx_fgconcept_product_snapshots_run
  on public.fgconcept_product_snapshots (scrape_run_id);

alter table public.fgconcept_product_scrape_runs enable row level security;
alter table public.fgconcept_products enable row level security;
alter table public.fgconcept_product_snapshots enable row level security;
