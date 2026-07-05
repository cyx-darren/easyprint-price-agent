create table if not exists public.weaver_overseas_supplier_mapping (
  id uuid primary key default gen_random_uuid(),

  item_name text not null,
  usual_name text,
  supplier_name text not null,
  wechat_id text,
  group_chat_name text,
  remarks text,

  source_file text not null,
  source_sheet text not null,
  source_row_number integer not null check (source_row_number >= 1),
  raw_row jsonb not null default '{}'::jsonb,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint weaver_overseas_supplier_mapping_source_row_uq
    unique (source_file, source_sheet, source_row_number)
);

create index if not exists idx_weaver_overseas_supplier_mapping_item
  on public.weaver_overseas_supplier_mapping (lower(item_name));

create index if not exists idx_weaver_overseas_supplier_mapping_supplier
  on public.weaver_overseas_supplier_mapping (lower(supplier_name));

create index if not exists idx_weaver_overseas_supplier_mapping_active
  on public.weaver_overseas_supplier_mapping (is_active, supplier_name, item_name);

alter table public.weaver_overseas_supplier_mapping enable row level security;
