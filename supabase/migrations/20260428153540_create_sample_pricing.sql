create table if not exists public.sample_pricing (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,
  item_name text not null,
  sample_type text not null,
  pricing_group text not null,
  pricing_mode text not null,
  sample_price_ex_gst numeric(10,2),
  currency text not null default 'SGD',
  gst_applicable boolean not null default true,
  requires_supplier_check boolean not null default false,
  conditions text,
  exclusions text,
  active boolean not null default true,
  source_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sample_pricing_sample_type_check
    check (sample_type in ('physical_sample', 'photo_sample')),
  constraint sample_pricing_group_check
    check (pricing_group in ('simple_paper_in_house', 'standard_physical_custom', 'photo_sample', 'supplier_check')),
  constraint sample_pricing_mode_check
    check (pricing_mode in ('fixed', 'free', 'supplier_check')),
  constraint sample_pricing_currency_check
    check (currency = upper(currency) and length(currency) = 3),
  constraint sample_pricing_price_mode_check
    check (
      (pricing_mode = 'supplier_check' and sample_price_ex_gst is null)
      or (pricing_mode = 'fixed' and sample_price_ex_gst is not null and sample_price_ex_gst >= 0)
      or (pricing_mode = 'free' and sample_price_ex_gst = 0)
    )
);

alter table public.sample_pricing enable row level security;

create index if not exists idx_sample_pricing_group
  on public.sample_pricing (pricing_group)
  where active = true;

create index if not exists idx_sample_pricing_sample_type
  on public.sample_pricing (sample_type)
  where active = true;

create index if not exists idx_sample_pricing_supplier_check
  on public.sample_pricing (requires_supplier_check)
  where active = true;

create or replace function public.set_sample_pricing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sample_pricing_updated_at on public.sample_pricing;
create trigger set_sample_pricing_updated_at
before update on public.sample_pricing
for each row
execute function public.set_sample_pricing_updated_at();

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
  source_note
) values
  (
    'simple_paper_booklets',
    'Booklets',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house paper booklet samples with standard paper stocks and normal binding such as saddle stitch or perfect binding.',
    'Excludes hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and any supplier-led/custom finishing that requires external confirmation.',
    'Seeded from sample-pricing policy: simple paper/in-house samples are usually $10 + GST.'
  ),
  (
    'simple_paper_flyers_leaflets',
    'Flyers / leaflets',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house flyer and leaflet samples on standard paper stocks.',
    'Excludes hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and any supplier-led/custom finishing that requires external confirmation.',
    'Seeded from sample-pricing policy: simple paper/in-house samples are usually $10 + GST.'
  ),
  (
    'simple_paper_brochures',
    'Simple brochures',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house brochure samples. Simple folding is allowed.',
    'Excludes hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and any supplier-led/custom finishing that requires external confirmation.',
    'Seeded from sample-pricing policy: simple paper/in-house samples are usually $10 + GST.'
  ),
  (
    'simple_paper_trifold_brochures',
    'Tri-fold brochures',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house tri-fold brochure samples.',
    'Excludes hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and any supplier-led/custom finishing that requires external confirmation.',
    'Seeded from sample-pricing policy: simple folding is acceptable at $10 + GST.'
  ),
  (
    'simple_paper_folded_brochures',
    'Folded brochures: half-fold, Z-fold, roll-fold, gate-fold, cross-fold',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house folded brochure samples, including half-fold, Z-fold, roll-fold, gate-fold, and cross-fold.',
    'Excludes hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and any supplier-led/custom finishing that requires external confirmation.',
    'Seeded from sample-pricing policy: simple folding is acceptable at $10 + GST.'
  ),
  (
    'simple_paper_event_badges',
    'Paper event badges',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to paper event badge samples produced in-house, including standard slotting/round corners and standard lamination where available.',
    'Excludes PVC event badges, supplier-led custom badges, hotstamp, deboss, emboss, foil/block setup, and special diecut/custom shapes.',
    'Seeded from sample-pricing policy and current catalog category Event Badges.'
  ),
  (
    'simple_paper_posters',
    'Posters / foam-board posters',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple poster and foam-board poster samples produced in-house using standard sizes and materials.',
    'Excludes special mounting, unusual substrates, supplier-led/custom finishing, and special diecut/custom shapes.',
    'Seeded from sample-pricing policy and current catalog category Posters.'
  ),
  (
    'simple_paper_certificates',
    'Certificates',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house certificate samples on standard paper/card stocks.',
    'Excludes certificate holders with diecut slits, hotstamp, deboss, emboss, foil/block setup, and custom diecut shapes.',
    'Seeded from sample-pricing policy: comparable simple paper items qualify at $10 + GST.'
  ),
  (
    'simple_paper_postcards_cards',
    'Postcards / cards',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house postcard and card samples on standard paper/card stocks.',
    'Excludes greeting cards or packaging that requires special diecut, hotstamp, deboss, emboss, foil/block setup, or supplier-led/custom finishing.',
    'Seeded from sample-pricing policy: comparable simple paper items qualify at $10 + GST.'
  ),
  (
    'simple_paper_name_cards',
    'Name cards',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house name card samples on standard stocks and standard rectangular cutting.',
    'Excludes hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and premium finishing requiring setup blocks.',
    'Seeded from sample-pricing policy: comparable simple paper items qualify at $10 + GST.'
  ),
  (
    'simple_paper_coupons_tickets_vouchers',
    'Coupons / tickets / vouchers',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house coupon, ticket, and voucher samples using standard paper/card stocks.',
    'Excludes special perforation if it requires nonstandard setup, hotstamp, deboss, emboss, foil/block setup, and special diecut/custom shapes.',
    'Seeded from sample-pricing policy: comparable simple paper items qualify at $10 + GST.'
  ),
  (
    'simple_paper_tent_cards_table_cards',
    'Tent cards / table cards',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house tent card and table card samples with standard scoring/folding.',
    'Excludes hotstamp, deboss, emboss, foil/block setup, special diecut/custom shapes, and supplier-led/custom finishing.',
    'Seeded from sample-pricing policy: simple paper/in-house samples are usually $10 + GST.'
  ),
  (
    'simple_paper_standard_shape_stickers_decals',
    'Standard-shape stickers / decals',
    'physical_sample',
    'simple_paper_in_house',
    'fixed',
    10.00,
    'SGD',
    true,
    false,
    'Applies to simple in-house standard-shape sticker or decal samples where no custom diecut block is needed.',
    'Excludes special diecut/custom shapes, supplier-led stickers/decals, hotstamp, deboss, emboss, and foil/block setup.',
    'Seeded from sample-pricing policy and current catalog category Stickers & Decals.'
  ),
  (
    'standard_physical_corporate_gifts_default',
    'Corporate gifts default',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Default physical sample fee for printed physical/custom corporate gift samples unless a supplier quote says otherwise.',
    'Supplier-led, overseas, highly custom, or block/tooling-heavy items should be checked with procurement/factory first if cost is uncertain.',
    'Seeded from sample-pricing policy: standard physical/custom samples are often $50 + GST.'
  ),
  (
    'standard_physical_bags',
    'Tote bags, jute bags, non-woven bags, drawstring bags, pouches',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for bag and pouch products.',
    'Check supplier/factory first for unusual materials, custom construction, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog categories Canvas Tote Bags and Carriers, Tote Bags, Pouches.'
  ),
  (
    'standard_physical_drinkware',
    'Drinkware: tumblers, mugs, bottles, flasks',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for standard drinkware products.',
    'Check supplier/factory first for unusual finishing, custom moulds, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog category Drinkware.'
  ),
  (
    'standard_physical_apparel_headwear',
    'Apparel/headwear: T-shirts, polos, caps, towels, vests',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed or embroidered physical samples for apparel and headwear products.',
    'Check supplier/factory first for special embroidery setup, unusual garment sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog category Apparel & Headwear.'
  ),
  (
    'standard_physical_lanyards_holders',
    'Lanyards and card holders',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for lanyards and card holders.',
    'Check supplier/factory first for overseas/custom lanyards, unusual attachments, or supplier-specific sample fees.',
    'Seeded from current catalog category Lanyards & Holders.'
  ),
  (
    'standard_physical_notebooks',
    'Notebooks, including PU leather notebooks',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to physical samples for notebooks. PU leather notebook photo samples are usually not complimentary because startup/setup can be costly.',
    'Check supplier/factory first for thread-sewn binding startup, deboss blocks, special covers, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog category Notebooks and sample-pricing policy exception for PU leather notebooks.'
  ),
  (
    'standard_physical_pens_stationery_gifts',
    'Pens and stationery gifts',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for pens and stationery gift products.',
    'Check supplier/factory first for premium sets, unusual engraving, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog category Corporate Gifts.'
  ),
  (
    'standard_physical_umbrellas',
    'Umbrellas',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for umbrellas.',
    'Check supplier/factory first for unusual construction, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog category Umbrellas.'
  ),
  (
    'standard_physical_electronics_gadgets',
    'Electronics/gadgets',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for electronics and gadget products.',
    'Check supplier/factory first for branded electronics, safety/compliance-sensitive items, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog category Electronics & Gadgets.'
  ),
  (
    'standard_physical_kitchenware_lifestyle_office',
    'Kitchenware, travel/lifestyle, and office essentials',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for kitchenware, travel/lifestyle, and office essential products.',
    'Check supplier/factory first for unusual materials, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog categories Kitchenware, Travel & Lifestyle, Office Essentials.'
  ),
  (
    'standard_physical_misc_corporate_gifts',
    'Wristbands, stress balls, luggage tags, coasters',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to printed physical samples for common miscellaneous corporate gift products.',
    'Check supplier/factory first for custom moulds, overseas sourcing, or supplier-specific sample fees.',
    'Seeded from current catalog category Corporate Gifts.'
  ),
  (
    'standard_physical_keychains',
    'PVC/acrylic/enamel keychains',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    true,
    'Applies to physical samples for custom keychains. Photo samples may not be complimentary because factories may need to fabricate blocks or tooling.',
    'Confirm with supplier/factory when there are mould, block, tooling, or overseas setup charges above the standard sample fee.',
    'Seeded from sample-pricing policy exception for enamel/acrylic keychains.'
  ),
  (
    'standard_physical_enamel_pin_badges',
    'Enamel pin badges',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    true,
    'Applies to physical samples for enamel pin badges. Photo samples may not be complimentary because factories may need to fabricate blocks or tooling.',
    'Confirm with supplier/factory when there are mould, block, tooling, or overseas setup charges above the standard sample fee.',
    'Seeded from current catalog category Badges & Pins and sample-pricing policy exception for enamel pin badges.'
  ),
  (
    'standard_physical_rollup_banners_displays',
    'Roll-up banners / display items',
    'physical_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    false,
    'Applies to physical samples for display items that are not simple in-house paper poster samples.',
    'Check supplier/factory first for large-format, supplier-led, or custom display items with unusual hardware or finishing.',
    'Seeded from current catalog category Banners & Displays.'
  ),
  (
    'photo_sample_default',
    'Photo sample default',
    'photo_sample',
    'photo_sample',
    'free',
    0.00,
    'SGD',
    false,
    false,
    'Photo sample is generally complimentary and preferred when timeline is tight or to avoid unnecessary cost.',
    'Does not apply where supplier charges, or where the item requires block/tooling/factory setup for even a photo sample.',
    'Seeded from sample-pricing policy: photo samples are often free unless supplier charges.'
  ),
  (
    'photo_sample_supplier_charged',
    'Photo sample where supplier charges',
    'photo_sample',
    'supplier_check',
    'supplier_check',
    null,
    'SGD',
    true,
    true,
    'Use when the supplier/factory charges for a photo sample or when sample cost depends on supplier terms.',
    'Do not promise complimentary photo sample before checking supplier/factory.',
    'Seeded from sample-pricing policy: supplier-led/custom item should be checked first.'
  ),
  (
    'photo_sample_enamel_pin_badge_exception',
    'Enamel pin badge photo sample exception',
    'photo_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    true,
    'Photo sample is usually not complimentary because factories may need to fabricate block/tooling. Charge physical sample fee by default.',
    'Confirm with supplier/factory when actual setup cost is higher than the standard physical sample fee.',
    'Seeded from sample-pricing policy exception for enamel pin badges.'
  ),
  (
    'photo_sample_enamel_acrylic_keychain_exception',
    'Enamel/acrylic keychain photo sample exception',
    'photo_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    true,
    'Photo sample is usually not complimentary because factories may need to fabricate block/tooling. Charge physical sample fee by default.',
    'Confirm with supplier/factory when actual setup cost is higher than the standard physical sample fee.',
    'Seeded from sample-pricing policy exception for enamel/acrylic keychains.'
  ),
  (
    'photo_sample_pu_leather_notebook_exception',
    'PU leather notebook photo sample exception',
    'photo_sample',
    'standard_physical_custom',
    'fixed',
    50.00,
    'SGD',
    true,
    true,
    'Photo sample is usually not complimentary because starting the thread-sewn binding machine can be costly for one approval piece. Charge physical sample fee by default.',
    'Confirm with supplier/factory when actual setup cost is higher than the standard physical sample fee.',
    'Seeded from sample-pricing policy exception for PU leather notebooks.'
  ),
  (
    'supplier_led_custom_item',
    'Supplier-led/custom sourced item',
    'physical_sample',
    'supplier_check',
    'supplier_check',
    null,
    'SGD',
    true,
    true,
    'Use when the item is sourced/custom/overseas or sample cost depends on supplier/factory/procurement confirmation.',
    'Check supplier/factory and profit before deciding whether to absorb or pass on the sample fee.',
    'Seeded from sample-pricing policy: supplier-led/custom items require supplier/factory confirmation.'
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
  updated_at = now();
