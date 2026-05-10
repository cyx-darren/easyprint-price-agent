create table if not exists public.pricing_benchmark_snapshot_batches (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  source_sheet_url text not null,
  source_sheet_gid text not null,
  source_row_count integer not null check (source_row_count >= 0),
  source_headers jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamp with time zone not null default now(),
  constraint pricing_benchmark_snapshot_batches_source_key
    unique (snapshot_date, source_sheet_url, source_sheet_gid)
);

create table if not exists public.pricing_benchmark_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch_id uuid not null
    references public.pricing_benchmark_snapshot_batches(id)
    on delete restrict,
  pricing_id uuid not null
    references public.pricing(id)
    on delete restrict,
  product_source text,
  print_vendor_source text,
  item_unit_cost numeric,
  total_item_cost numeric,
  no_of_print_methods integer,
  print_method_1 text,
  no_of_positions_1 integer,
  print_method_1_cost numeric,
  print_method_1_cost_basis text,
  print_method_2 text,
  print_method_2_cost numeric,
  print_method_2_cost_basis text,
  block_charges numeric,
  total_print_cost numeric,
  average_print_unit_cost numeric,
  benchmark_profit_amount numeric,
  benchmark_profit_percentage numeric,
  preferred_benchmark_basis text,
  raw_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint pricing_benchmark_snapshots_batch_pricing_key
    unique (snapshot_batch_id, pricing_id),
  constraint pricing_benchmark_snapshots_basis_check
    check (
      preferred_benchmark_basis is null
      or preferred_benchmark_basis in ('profit_amount', 'profit_percentage', 'manual')
    )
);

create index if not exists idx_pricing_benchmark_snapshots_batch
  on public.pricing_benchmark_snapshots (snapshot_batch_id);

create index if not exists idx_pricing_benchmark_snapshots_pricing
  on public.pricing_benchmark_snapshots (pricing_id);

create index if not exists idx_pricing_benchmark_snapshot_batches_date
  on public.pricing_benchmark_snapshot_batches (snapshot_date);

alter table public.pricing_benchmark_snapshot_batches enable row level security;
alter table public.pricing_benchmark_snapshots enable row level security;
