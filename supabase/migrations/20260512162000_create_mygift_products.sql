create table if not exists public.mygift_product_scrape_runs (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'MYGIFT',
  source_url text not null default 'http://www.mygiftuniversal.com.my/calculator.php',
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

  constraint mygift_product_scrape_runs_run_type_chk check (run_type in ('full', 'partial')),
  constraint mygift_product_scrape_runs_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create table if not exists public.mygift_products (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'MYGIFT',
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

  constraint mygift_products_vendor_item_code_uq unique (vendor, item_code)
);

create table if not exists public.mygift_product_snapshots (
  id uuid primary key default gen_random_uuid(),

  scrape_run_id uuid not null references public.mygift_product_scrape_runs(id) on delete restrict,

  vendor text not null default 'MYGIFT',
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

  constraint mygift_product_snapshots_run_item_uq unique (scrape_run_id, vendor, item_code)
);

create index if not exists idx_mygift_products_series_code
  on public.mygift_products (series_code);

create index if not exists idx_mygift_products_active
  on public.mygift_products (is_active, series_code, item_code);

create index if not exists idx_mygift_products_decoration_methods
  on public.mygift_products using gin (decoration_methods);

create index if not exists idx_mygift_product_snapshots_item_code
  on public.mygift_product_snapshots (vendor, item_code, scraped_at desc);

create index if not exists idx_mygift_product_snapshots_run
  on public.mygift_product_snapshots (scrape_run_id);

alter table public.mygift_product_scrape_runs enable row level security;
alter table public.mygift_products enable row level security;
alter table public.mygift_product_snapshots enable row level security;
