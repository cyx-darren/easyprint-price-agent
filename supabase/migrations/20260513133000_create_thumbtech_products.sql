create table if not exists public.thumbtech_product_scrape_runs (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'THUMBTECH',
  source_type text not null default 'pdf',
  source_files text[] not null default '{}',
  run_type text not null,
  status text not null,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  series_count integer not null default 0 check (series_count >= 0),
  succeeded_series_count integer not null default 0 check (succeeded_series_count >= 0),
  failed_series_count integer not null default 0 check (failed_series_count >= 0),
  product_count integer not null default 0 check (product_count >= 0),
  skipped_product_count integer not null default 0 check (skipped_product_count >= 0),
  excluded_clearance_count integer not null default 0 check (excluded_clearance_count >= 0),

  failed_series text[] not null default '{}',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint thumbtech_product_scrape_runs_run_type_chk check (run_type in ('full', 'partial')),
  constraint thumbtech_product_scrape_runs_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create table if not exists public.thumbtech_products (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'THUMBTECH',
  source_catalog text,
  source_file text,
  source_pdf_page integer check (source_pdf_page is null or source_pdf_page > 0),
  source_row_number integer check (source_row_number is null or source_row_number > 0),
  source_row_key text,

  series_code text not null,
  item_code text not null,
  sku_colour text,
  colour text,

  product_name text,
  description text,
  product_details text,
  packaging text,
  material text,
  dimensions text,
  weight text,
  capacity text,
  warranty text,

  item_unit_price numeric(12,2),
  currency text not null default 'SGD',

  image_url text,
  image_urls jsonb not null default '[]'::jsonb,

  stock_status text,
  stock_level_quantity integer check (stock_level_quantity is null or stock_level_quantity >= 0),
  reserved_quantity integer check (reserved_quantity is null or reserved_quantity >= 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  incoming_stock jsonb not null default '{}'::jsonb,

  supplier_labels text[] not null default '{}',
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

  constraint thumbtech_products_vendor_item_code_uq unique (vendor, item_code)
);

create table if not exists public.thumbtech_product_snapshots (
  id uuid primary key default gen_random_uuid(),

  scrape_run_id uuid not null references public.thumbtech_product_scrape_runs(id) on delete restrict,

  vendor text not null default 'THUMBTECH',
  source_catalog text,
  source_file text,
  source_pdf_page integer check (source_pdf_page is null or source_pdf_page > 0),
  source_row_number integer check (source_row_number is null or source_row_number > 0),
  source_row_key text,

  series_code text not null,
  item_code text not null,
  sku_colour text,
  colour text,

  product_name text,
  description text,
  product_details text,
  packaging text,
  material text,
  dimensions text,
  weight text,
  capacity text,
  warranty text,

  item_unit_price numeric(12,2),
  currency text not null default 'SGD',

  image_url text,
  image_urls jsonb not null default '[]'::jsonb,

  stock_status text,
  stock_level_quantity integer check (stock_level_quantity is null or stock_level_quantity >= 0),
  reserved_quantity integer check (reserved_quantity is null or reserved_quantity >= 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  incoming_stock jsonb not null default '{}'::jsonb,

  supplier_labels text[] not null default '{}',
  decoration_methods text[] not null default '{}',
  raw_product jsonb not null default '{}'::jsonb,

  scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint thumbtech_product_snapshots_run_item_uq unique (scrape_run_id, vendor, item_code)
);

create index if not exists idx_thumbtech_products_series_code
  on public.thumbtech_products (series_code);

create index if not exists idx_thumbtech_products_active
  on public.thumbtech_products (is_active, series_code, item_code);

create index if not exists idx_thumbtech_products_source_catalog
  on public.thumbtech_products (source_catalog);

create index if not exists idx_thumbtech_products_decoration_methods
  on public.thumbtech_products using gin (decoration_methods);

create index if not exists idx_thumbtech_products_supplier_labels
  on public.thumbtech_products using gin (supplier_labels);

create index if not exists idx_thumbtech_product_snapshots_item_code
  on public.thumbtech_product_snapshots (vendor, item_code, scraped_at desc);

create index if not exists idx_thumbtech_product_snapshots_run
  on public.thumbtech_product_snapshots (scrape_run_id);

create index if not exists idx_thumbtech_product_snapshots_source_catalog
  on public.thumbtech_product_snapshots (source_catalog);

alter table public.thumbtech_product_scrape_runs enable row level security;
alter table public.thumbtech_products enable row level security;
alter table public.thumbtech_product_snapshots enable row level security;
