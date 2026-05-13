create table if not exists public.dealers_fg_stock_import_runs (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'DEALERS_FG',
  source_sheet_id text not null,
  source_sheet_gid text not null,
  source_sheet_url text not null,

  run_type text not null,
  status text not null,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  source_row_count integer not null default 0 check (source_row_count >= 0),
  parsed_stock_count integer not null default 0 check (parsed_stock_count >= 0),

  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint dealers_fg_stock_import_runs_run_type_chk check (run_type in ('full', 'partial')),
  constraint dealers_fg_stock_import_runs_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create table if not exists public.dealers_fg_stock_balances (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'DEALERS_FG',
  item_code text not null,
  variant_key text not null,

  product_description text,
  variant_description text,

  dealer_price numeric(12,2),
  currency text not null default 'SGD',
  stock_balance integer check (stock_balance is null or stock_balance >= 0),

  source_row_number integer not null check (source_row_number >= 1),
  source_sheet_id text not null,
  source_sheet_gid text not null,

  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_scraped_at timestamptz not null default now(),
  missing_since_at timestamptz,

  raw_row jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dealers_fg_stock_balances_vendor_item_variant_uq unique (vendor, item_code, variant_key)
);

create table if not exists public.dealers_fg_stock_snapshots (
  id uuid primary key default gen_random_uuid(),

  import_run_id uuid not null references public.dealers_fg_stock_import_runs(id) on delete restrict,

  vendor text not null default 'DEALERS_FG',
  item_code text not null,
  variant_key text not null,

  product_description text,
  variant_description text,

  dealer_price numeric(12,2),
  currency text not null default 'SGD',
  stock_balance integer check (stock_balance is null or stock_balance >= 0),

  source_row_number integer not null check (source_row_number >= 1),
  source_sheet_id text not null,
  source_sheet_gid text not null,
  raw_row jsonb not null default '{}'::jsonb,

  scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint dealers_fg_stock_snapshots_run_item_variant_uq unique (import_run_id, vendor, item_code, variant_key)
);

create index if not exists idx_dealers_fg_stock_balances_item_code
  on public.dealers_fg_stock_balances (item_code);

create index if not exists idx_dealers_fg_stock_balances_active
  on public.dealers_fg_stock_balances (is_active, item_code, variant_key);

create index if not exists idx_dealers_fg_stock_snapshots_item_code
  on public.dealers_fg_stock_snapshots (vendor, item_code, scraped_at desc);

create index if not exists idx_dealers_fg_stock_snapshots_run
  on public.dealers_fg_stock_snapshots (import_run_id);

alter table public.dealers_fg_stock_import_runs enable row level security;
alter table public.dealers_fg_stock_balances enable row level security;
alter table public.dealers_fg_stock_snapshots enable row level security;
