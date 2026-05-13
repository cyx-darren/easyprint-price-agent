create table if not exists public.venue31_charges (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'VENUE31',
  charge_name text not null default 'Embroidery',
  print_method text not null default 'embroidery',

  size_bucket text not null,
  raw_size_label text not null,
  max_width_cm numeric(6,2),
  max_height_cm numeric(6,2),

  raw_quantity text not null,
  qty_min integer not null check (qty_min >= 0),
  qty_max integer check (qty_max is null or qty_max >= qty_min),

  charge_type text not null default 'per_piece',
  charge_amount numeric(10,2) not null check (charge_amount >= 0),
  unit text not null default 'piece',

  currency text not null default 'SGD',
  gst_included boolean not null default false,

  source_doc text not null default 'Venue31 embroidery pricing',
  effective_date date,
  notes text,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venue31_charges_size_bucket_chk check (size_bucket in (
    'within_8cm_x_8cm',
    'bigger_than_8cm_x_8cm'
  )),
  constraint venue31_charges_charge_type_chk check (charge_type = 'per_piece'),
  constraint venue31_charges_unit_chk check (unit = 'piece')
);

create index if not exists idx_venue31_charges_lookup
  on public.venue31_charges (is_active, print_method, size_bucket, qty_min, qty_max);

create unique index if not exists uq_venue31_charges_active_rule
  on public.venue31_charges (
    vendor,
    print_method,
    size_bucket,
    qty_min,
    coalesce(qty_max, 2147483647),
    charge_type,
    unit
  ) where is_active = true;

with seed_rows (
  size_bucket,
  raw_size_label,
  max_width_cm,
  max_height_cm,
  raw_quantity,
  qty_min,
  qty_max,
  charge_amount,
  notes
) as (
  values
    (
      'within_8cm_x_8cm',
      'Embroidery charges (within 8cm x 8cm)',
      8.00::numeric,
      8.00::numeric,
      '30pcs',
      30,
      99,
      2.50::numeric,
      'Use this size bucket only when both embroidery width and height are <= 8cm.'
    ),
    (
      'within_8cm_x_8cm',
      'Embroidery charges (within 8cm x 8cm)',
      8.00::numeric,
      8.00::numeric,
      '100pcs',
      100,
      249,
      2.00::numeric,
      'Use this size bucket only when both embroidery width and height are <= 8cm.'
    ),
    (
      'within_8cm_x_8cm',
      'Embroidery charges (within 8cm x 8cm)',
      8.00::numeric,
      8.00::numeric,
      '250pcs',
      250,
      null::integer,
      1.50::numeric,
      'Use this size bucket only when both embroidery width and height are <= 8cm.'
    ),
    (
      'bigger_than_8cm_x_8cm',
      'Embroidery charges (bigger than 8cm x 8cm)',
      null::numeric,
      null::numeric,
      '30pcs',
      30,
      99,
      3.50::numeric,
      'Use this size bucket when embroidery width or height is bigger than 8cm.'
    ),
    (
      'bigger_than_8cm_x_8cm',
      'Embroidery charges (bigger than 8cm x 8cm)',
      null::numeric,
      null::numeric,
      '100pcs',
      100,
      249,
      2.50::numeric,
      'Use this size bucket when embroidery width or height is bigger than 8cm.'
    ),
    (
      'bigger_than_8cm_x_8cm',
      'Embroidery charges (bigger than 8cm x 8cm)',
      null::numeric,
      null::numeric,
      '250pcs',
      250,
      null::integer,
      2.00::numeric,
      'Use this size bucket when embroidery width or height is bigger than 8cm.'
    )
)
insert into public.venue31_charges (
  size_bucket,
  raw_size_label,
  max_width_cm,
  max_height_cm,
  raw_quantity,
  qty_min,
  qty_max,
  charge_amount,
  notes
)
select
  seed_rows.size_bucket,
  seed_rows.raw_size_label,
  seed_rows.max_width_cm,
  seed_rows.max_height_cm,
  seed_rows.raw_quantity,
  seed_rows.qty_min,
  seed_rows.qty_max,
  seed_rows.charge_amount,
  seed_rows.notes
from seed_rows
where not exists (
  select 1
  from public.venue31_charges existing
  where existing.vendor = 'VENUE31'
    and existing.print_method = 'embroidery'
    and existing.size_bucket = seed_rows.size_bucket
    and existing.qty_min = seed_rows.qty_min
    and coalesce(existing.qty_max, 2147483647) = coalesce(seed_rows.qty_max, 2147483647)
    and existing.charge_type = 'per_piece'
    and existing.unit = 'piece'
    and existing.is_active = true
);

alter table public.venue31_charges enable row level security;
