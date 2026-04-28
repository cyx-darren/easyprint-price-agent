alter table public.sample_pricing
  add column if not exists lead_time_days_min integer,
  add column if not exists lead_time_days_max integer,
  add column if not exists lead_time_basis text not null default 'case_by_case',
  add column if not exists waiver_policy text not null default 'case_by_case',
  add column if not exists refund_policy text not null default 'none',
  add column if not exists design_change_policy text not null default 'case_by_case',
  add column if not exists design_change_fee_ex_gst numeric(10,2),
  add column if not exists requires_return boolean not null default false,
  add column if not exists return_window_days integer;

update public.sample_pricing
set
  lead_time_days_min = 3,
  lead_time_days_max = 5,
  lead_time_basis = 'historical_range',
  waiver_policy = 'case_by_case',
  refund_policy = 'case_by_case',
  design_change_policy = 'charge_after_first_grace',
  design_change_fee_ex_gst = sample_price_ex_gst,
  requires_return = false,
  return_window_days = null,
  updated_at = now()
where pricing_group = 'simple_paper_in_house'
  and pricing_mode = 'fixed'
  and sample_price_ex_gst = 10.00;

update public.sample_pricing
set
  lead_time_days_min = 5,
  lead_time_days_max = 7,
  lead_time_basis = 'historical_range',
  waiver_policy = 'case_by_case',
  refund_policy = 'case_by_case',
  design_change_policy = 'charge_after_first_grace',
  design_change_fee_ex_gst = 50.00,
  requires_return = false,
  return_window_days = null,
  updated_at = now()
where item_key = 'standard_physical_apparel_headwear';

update public.sample_pricing
set
  lead_time_days_min = null,
  lead_time_days_max = null,
  lead_time_basis = 'case_by_case',
  waiver_policy = 'case_by_case',
  refund_policy = 'case_by_case',
  design_change_policy = 'charge_after_first_grace',
  design_change_fee_ex_gst = 50.00,
  requires_return = false,
  return_window_days = null,
  updated_at = now()
where pricing_group = 'standard_physical_custom'
  and pricing_mode = 'fixed'
  and sample_price_ex_gst = 50.00
  and item_key <> 'standard_physical_apparel_headwear';

update public.sample_pricing
set
  lead_time_days_min = 3,
  lead_time_days_max = 6,
  lead_time_basis = 'historical_range',
  waiver_policy = 'complimentary_once',
  refund_policy = 'none',
  design_change_policy = 'charge_after_first_grace',
  design_change_fee_ex_gst = 50.00,
  requires_return = false,
  return_window_days = null,
  conditions = 'Photo/video proof sample is generally complimentary once where feasible and preferred when timeline is tight or to avoid unnecessary cost.',
  updated_at = now()
where item_key = 'photo_sample_default';

update public.sample_pricing
set
  lead_time_days_min = null,
  lead_time_days_max = null,
  lead_time_basis = 'case_by_case',
  waiver_policy = 'case_by_case',
  refund_policy = 'case_by_case',
  design_change_policy = 'case_by_case',
  design_change_fee_ex_gst = null,
  requires_return = false,
  return_window_days = null,
  updated_at = now()
where pricing_mode = 'supplier_check';

insert into public.sample_pricing (
  item_key,
  item_name,
  sample_type,
  pricing_group,
  pricing_mode,
  sample_price_ex_gst,
  currency,
  gst_applicable,
  requires_supplier_check,
  conditions,
  exclusions,
  source_note,
  lead_time_days_min,
  lead_time_days_max,
  lead_time_basis,
  waiver_policy,
  refund_policy,
  design_change_policy,
  design_change_fee_ex_gst,
  requires_return,
  return_window_days
) values
  (
    'twenty_paper_printed_handouts',
    'Printed handouts / pictorial guide handouts',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    20.00,
    'SGD',
    true,
    false,
    'Applies to B5 pictorial guide printed handouts and similar non-standard handout samples that are more involved than a basic flyer.',
    'Excludes hotstamp, deboss, emboss, spot UV, foil/block setup, special diecut/custom shapes, and supplier-led/custom finishing.',
    'Seeded from Discord report record 22: B5 pictorial guide printed handouts at $20 sample fee, 5 working days.',
    5,
    5,
    'historical_range',
    'case_by_case',
    'case_by_case',
    'charge_after_first_grace',
    20.00,
    false,
    null
  ),
  (
    'twenty_paper_a5_notepads',
    'A5 notepads / simple notepad samples',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    20.00,
    'SGD',
    true,
    false,
    'Applies to A5 notepad and simple notepad physical samples.',
    'Excludes PU leather notebooks, custom thread-sewn binding, deboss blocks, hotstamp, special diecut/custom shapes, and supplier-led/custom finishing.',
    'Seeded from Discord report records 45, 47, and 81; user confirmed lead time should be 2-4 working days.',
    2,
    4,
    'historical_range',
    'complimentary_once',
    'case_by_case',
    'charge_after_first_grace',
    20.00,
    false,
    null
  ),
  (
    'twenty_paper_certificate_holder_backing',
    'Certificate holder backing',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    20.00,
    'SGD',
    true,
    false,
    'Applies to one-piece certificate holder backing samples.',
    'Excludes full certificate holders with diecut slits, special pockets, hotstamp, deboss, emboss, foil/block setup, and custom diecut shapes.',
    'Seeded from Discord report record 48; user confirmed lead time should be 3-5 working days.',
    3,
    5,
    'historical_range',
    'case_by_case',
    'case_by_case',
    'charge_after_first_grace',
    20.00,
    false,
    null
  ),
  (
    'twenty_paper_custom_card_flyer',
    'Custom card flyer / non-standard card flyer physical sample',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    20.00,
    'SGD',
    true,
    false,
    'Applies to non-standard card flyer physical samples, including unusual dimensions or stocks that are more involved than a basic flyer.',
    'Excludes spot UV, hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and supplier-led/custom finishing.',
    'Seeded from Discord report record 87; user confirmed lead time should be 3-7 working days.',
    3,
    7,
    'historical_range',
    'case_by_case',
    'case_by_case',
    'charge_after_first_grace',
    20.00,
    false,
    null
  ),
  (
    'twenty_paper_repeat_notepad_design_change',
    'Repeat/new notepad sample after design change',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    20.00,
    'SGD',
    true,
    false,
    'Applies when a new notepad sample is required after the first sample/proof because the customer changes the design.',
    'Does not apply to supplier-led notebooks, PU leather notebooks, or samples that require special block/tooling setup.',
    'Seeded from Discord report record 81: complimentary first sample may be allowed, but new samples after design changes are chargeable at $20.',
    2,
    4,
    'historical_range',
    'complimentary_once',
    'case_by_case',
    'charge_after_first_grace',
    20.00,
    false,
    null
  ),
  (
    'loaned_ready_stock_viewing_samples',
    'Loaned ready-stock/viewing samples',
    'physical_sample',
    'photo_sample',
    'free',
    0.00,
    'SGD',
    false,
    false,
    'Applies when the team lends existing ready-stock/viewing samples for customer review instead of producing a new sample.',
    'Customer must return the sample after viewing. This does not cover newly produced or printed samples.',
    'Seeded from Discord report record 19: samples can be lent without customer payment and should be returned after one week.',
    null,
    null,
    'case_by_case',
    'lend_and_return',
    'none',
    'none',
    null,
    true,
    7
  )
on conflict (item_key) do update set
  item_name = excluded.item_name,
  sample_type = excluded.sample_type,
  pricing_group = excluded.pricing_group,
  pricing_mode = excluded.pricing_mode,
  sample_price_ex_gst = excluded.sample_price_ex_gst,
  currency = excluded.currency,
  gst_applicable = excluded.gst_applicable,
  requires_supplier_check = excluded.requires_supplier_check,
  conditions = excluded.conditions,
  exclusions = excluded.exclusions,
  active = true,
  source_note = excluded.source_note,
  lead_time_days_min = excluded.lead_time_days_min,
  lead_time_days_max = excluded.lead_time_days_max,
  lead_time_basis = excluded.lead_time_basis,
  waiver_policy = excluded.waiver_policy,
  refund_policy = excluded.refund_policy,
  design_change_policy = excluded.design_change_policy,
  design_change_fee_ex_gst = excluded.design_change_fee_ex_gst,
  requires_return = excluded.requires_return,
  return_window_days = excluded.return_window_days,
  updated_at = now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sample_pricing_lead_time_basis_check'
      and conrelid = 'public.sample_pricing'::regclass
  ) then
    alter table public.sample_pricing
      add constraint sample_pricing_lead_time_basis_check
      check (lead_time_basis in ('historical_range', 'case_by_case', 'supplier_check'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sample_pricing_waiver_policy_check'
      and conrelid = 'public.sample_pricing'::regclass
  ) then
    alter table public.sample_pricing
      add constraint sample_pricing_waiver_policy_check
      check (waiver_policy in ('case_by_case', 'complimentary_once', 'waive_for_goodwill_or_large_order', 'lend_and_return', 'none'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sample_pricing_refund_policy_check'
      and conrelid = 'public.sample_pricing'::regclass
  ) then
    alter table public.sample_pricing
      add constraint sample_pricing_refund_policy_check
      check (refund_policy in ('case_by_case', 'none', 'refundable_against_order'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sample_pricing_design_change_policy_check'
      and conrelid = 'public.sample_pricing'::regclass
  ) then
    alter table public.sample_pricing
      add constraint sample_pricing_design_change_policy_check
      check (design_change_policy in ('case_by_case', 'charge_after_first_grace', 'supplier_check', 'none'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sample_pricing_lead_time_range_check'
      and conrelid = 'public.sample_pricing'::regclass
  ) then
    alter table public.sample_pricing
      add constraint sample_pricing_lead_time_range_check
      check (
        (
          lead_time_days_min is null
          and lead_time_days_max is null
        )
        or (
          lead_time_days_min is not null
          and lead_time_days_max is not null
          and lead_time_days_min > 0
          and lead_time_days_max >= lead_time_days_min
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sample_pricing_policy_amounts_check'
      and conrelid = 'public.sample_pricing'::regclass
  ) then
    alter table public.sample_pricing
      add constraint sample_pricing_policy_amounts_check
      check (
        design_change_fee_ex_gst is null
        or design_change_fee_ex_gst >= 0
      );
  end if;
end $$;

create index if not exists idx_sample_pricing_lead_time_basis
  on public.sample_pricing (lead_time_basis)
  where active = true;

create index if not exists idx_sample_pricing_waiver_policy
  on public.sample_pricing (waiver_policy)
  where active = true;

create index if not exists idx_sample_pricing_design_change_policy
  on public.sample_pricing (design_change_policy)
  where active = true;
