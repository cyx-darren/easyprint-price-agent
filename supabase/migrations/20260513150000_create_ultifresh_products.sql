create table if not exists public.ultifresh_product_import_runs (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'ULTIFRESH',
  source_type text not null default 'pdf',
  source_file text not null,
  run_type text not null,
  status text not null,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  row_count integer not null default 0 check (row_count >= 0),
  product_count integer not null default 0 check (product_count >= 0),
  skipped_row_count integer not null default 0 check (skipped_row_count >= 0),
  failed_row_count integer not null default 0 check (failed_row_count >= 0),

  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint ultifresh_product_import_runs_run_type_chk check (run_type in ('full', 'partial')),
  constraint ultifresh_product_import_runs_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create table if not exists public.ultifresh_products (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'ULTIFRESH',
  design_group text,
  design_no integer check (design_no is null or design_no > 0),

  product_name text not null,
  series_code text not null,
  item_code text not null,
  catalog_page_range text,

  item_unit_price numeric(12,2),
  normal_agent_price numeric(12,2),
  ma_promo_price numeric(12,2),
  currency text not null default 'SGD',

  stock_status text not null default 'assumed_in_stock',
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  stock_assumption text not null default 'Ultifresh stock assumed always available; PDF does not provide stock quantities.',

  source_price_list_date date,
  source_file text not null,
  source_pdf_page integer not null check (source_pdf_page > 0),
  source_row_number integer not null check (source_row_number > 0),
  source_row_key text not null,

  size_surcharge_note text,
  categories text,
  subcategories text,

  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_imported_at timestamptz not null default now(),
  missing_since_at timestamptz,

  raw_product jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ultifresh_products_vendor_item_code_uq unique (vendor, item_code),
  constraint ultifresh_products_stock_status_chk check (stock_status in ('assumed_in_stock'))
);

create table if not exists public.ultifresh_product_snapshots (
  id uuid primary key default gen_random_uuid(),

  import_run_id uuid not null references public.ultifresh_product_import_runs(id) on delete restrict,

  vendor text not null default 'ULTIFRESH',
  design_group text,
  design_no integer check (design_no is null or design_no > 0),

  product_name text not null,
  series_code text not null,
  item_code text not null,
  catalog_page_range text,

  item_unit_price numeric(12,2),
  normal_agent_price numeric(12,2),
  ma_promo_price numeric(12,2),
  currency text not null default 'SGD',

  stock_status text not null default 'assumed_in_stock',
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  stock_assumption text not null default 'Ultifresh stock assumed always available; PDF does not provide stock quantities.',

  source_price_list_date date,
  source_file text not null,
  source_pdf_page integer not null check (source_pdf_page > 0),
  source_row_number integer not null check (source_row_number > 0),
  source_row_key text not null,

  size_surcharge_note text,
  raw_product jsonb not null default '{}'::jsonb,

  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint ultifresh_product_snapshots_run_item_uq unique (import_run_id, vendor, item_code),
  constraint ultifresh_product_snapshots_stock_status_chk check (stock_status in ('assumed_in_stock'))
);

create index if not exists idx_ultifresh_products_series_code
  on public.ultifresh_products (series_code);

create index if not exists idx_ultifresh_products_item_code
  on public.ultifresh_products (item_code);

create index if not exists idx_ultifresh_products_active
  on public.ultifresh_products (is_active, design_group, item_code);

create index if not exists idx_ultifresh_products_design_group
  on public.ultifresh_products (design_group);

create index if not exists idx_ultifresh_product_snapshots_item_code
  on public.ultifresh_product_snapshots (vendor, item_code, imported_at desc);

create index if not exists idx_ultifresh_product_snapshots_run
  on public.ultifresh_product_snapshots (import_run_id);

alter table public.ultifresh_product_import_runs enable row level security;
alter table public.ultifresh_products enable row level security;
alter table public.ultifresh_product_snapshots enable row level security;
