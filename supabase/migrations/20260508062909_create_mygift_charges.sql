create table if not exists public.mygift_charges (
  id uuid primary key default gen_random_uuid(),

  vendor text not null default 'MYGIFT',

  charge_name text not null,
  raw_item_name text,
  item_codes text[],

  print_method text,
  print_spec text,
  position text,

  raw_quantity text not null,
  qty_min integer not null check (qty_min >= 0),
  qty_max integer check (qty_max is null or qty_max >= qty_min),

  charge_type text not null,
  charge_amount numeric(10,2) not null check (charge_amount >= 0),
  unit text not null,

  currency text not null default 'SGD',
  gst_included boolean not null default false,

  notes text,
  source_doc text not null default 'Printing Price Guide - OSSG Gift Rev01',
  source_revision text default 'Rev01',
  effective_date date,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mygift_charges_charge_type_chk check (charge_type in (
    'flat_packet',
    'per_piece',
    'per_piece_per_colour',
    'per_piece_full_colour',
    'add_on_per_piece',
    'flat_add_on',
    'note'
  )),

  constraint mygift_charges_unit_chk check (unit in (
    'packet',
    'piece',
    'colour',
    'colour_position',
    'rule',
    'note'
  ))
);

create index if not exists idx_mygift_charges_lookup
  on public.mygift_charges (charge_name, print_method, qty_min, qty_max)
  where is_active = true;

create index if not exists idx_mygift_charges_item_codes
  on public.mygift_charges using gin (item_codes);

create unique index if not exists uq_mygift_charges_active_rule
  on public.mygift_charges (
    vendor,
    charge_name,
    coalesce(print_method, ''),
    coalesce(print_spec, ''),
    coalesce(position, ''),
    raw_quantity,
    qty_min,
    coalesce(qty_max, 2147483647),
    charge_type,
    unit
  ) where is_active = true;

create table if not exists public.mygift_category_mappings (
  id uuid primary key default gen_random_uuid(),

  product_name text,
  product_category text,
  supplier_name text default 'MYGIFT',
  supplier_code text,
  supplier_code_prefix text,

  mygift_charge_name text not null,
  default_print_method text,
  default_print_spec text,
  default_position text,

  mapping_type text not null,
  priority integer not null default 100,

  is_active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mygift_category_mappings_mapping_type_chk check (mapping_type in (
    'exact_product',
    'supplier_code',
    'supplier_code_prefix',
    'product_category',
    'manual_override'
  ))
);

create index if not exists idx_mygift_category_mappings_lookup
  on public.mygift_category_mappings
  (product_name, supplier_code, supplier_code_prefix, product_category, priority)
  where is_active = true;

create unique index if not exists uq_mygift_category_mappings_active_rule
  on public.mygift_category_mappings (
    coalesce(product_name, ''),
    coalesce(product_category, ''),
    coalesce(supplier_name, ''),
    coalesce(supplier_code, ''),
    coalesce(supplier_code_prefix, ''),
    mygift_charge_name,
    mapping_type
  ) where is_active = true;

insert into public.mygift_category_mappings
  (product_category, supplier_name, supplier_code_prefix, mygift_charge_name, default_print_method, default_print_spec, mapping_type, priority, notes)
values
  ('Metal Pens', 'MYGIFT', 'MP', 'Metal Pen (MP) / Plastic Pen (PP)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 50, 'MYGIFT MP prefix maps to Metal Pen / Plastic Pen charge.'),
  ('Plastic Pens', 'MYGIFT', 'PP', 'Metal Pen (MP) / Plastic Pen (PP)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 50, 'MYGIFT PP prefix maps to Metal Pen / Plastic Pen charge.'),

  ('Drinkware', 'MYGIFT', 'SB', 'Bottle/ Auto Mug/ Ceramic Mug/ Food Container (SB/CR/AM/CE/ VF)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 70, 'MYGIFT SB bottles map to bottle/mug/food container charge.'),
  ('Drinkware', 'MYGIFT', 'CR', 'Bottle/ Auto Mug/ Ceramic Mug/ Food Container (SB/CR/AM/CE/ VF)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 70, 'MYGIFT CR ceramic mugs map to bottle/mug/food container charge.'),
  ('Drinkware', 'MYGIFT', 'AM', 'Bottle/ Auto Mug/ Ceramic Mug/ Food Container (SB/CR/AM/CE/ VF)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 70, 'MYGIFT AM auto mugs map to bottle/mug/food container charge.'),
  ('Drinkware', 'MYGIFT', 'CE', 'Bottle/ Auto Mug/ Ceramic Mug/ Food Container (SB/CR/AM/CE/ VF)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 70, 'MYGIFT CE food/container items map to bottle/mug/food container charge.'),
  ('Drinkware', 'MYGIFT', 'VF', 'Bottle/ Auto Mug/ Ceramic Mug/ Food Container (SB/CR/AM/CE/ VF)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 70, 'MYGIFT VF items map to bottle/mug/food container charge.'),

  ('Non Woven Bags', 'MYGIFT', 'NW', 'Non Woven Bag (NW)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 50, 'MYGIFT NW prefix maps to Non Woven Bag charge. NW17 has +S$0.05/pc special add-on.'),
  ('Umbrellas', 'MYGIFT', 'UM', 'Umbrella (UM)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 50, 'MYGIFT UM prefix maps to Umbrella charge.'),
  ('Lanyards', 'MYGIFT', 'LD', 'Lanyard (LD)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 50, 'MYGIFT LD prefix maps to Lanyard charge.'),

  ('Stress Balls', 'MYGIFT', 'SA07', 'Stress Ball (SA07/SA08)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 40, 'MYGIFT SA07 stress balls map to Stress Ball charge.'),
  ('Stress Balls', 'MYGIFT', 'SA08', 'Stress Ball (SA07/SA08)', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 40, 'MYGIFT SA08 stress balls map to Stress Ball charge.'),

  ('Bags', 'MYGIFT', 'JB', 'Bag - Nylon, Canvas, Jute', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 80, 'MYGIFT JB/Jute bag fallback mapping. Confirm exact products over time.'),
  ('Hand Fans', 'MYGIFT', 'SA12', 'Hand Fan (SA12) - 1 Side', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 40, 'MYGIFT SA12 hand fan maps to Hand Fan 1 Side charge.'),
  ('Sunshades', 'MYGIFT', 'SA20', 'Sunshade (SA20) for 1 side', 'silkscreen', '1 colour x 1 position', 'supplier_code_prefix', 40, 'MYGIFT SA20 sunshade maps to Sunshade 1 Side charge.'),

  ('Keychains', 'MYGIFT', 'KC', 'Paper Print Acrylic KeyChain (KC06-KC09)', 'paper_print', 'full colour', 'supplier_code_prefix', 90, 'MYGIFT KC prefix fallback. Exact keychain mappings should override because KC may use engraving, UV, epoxy, or paper print depending material.')
on conflict do nothing;
