-- Links the heat transfer lanyard pricelist into the shared products lookup chain:
--   * adds a products row for 'Heat Transfer (Dye Sublimation) Lanyard' carrying the
--     EasyPrint website product id ece775be-d6de-409f-a129-152d850dba26 (the website's
--     "Lanyards (with printing)" product), so website_product_id -> products.id resolves it
--   * rebuilds the heat_transfer_lanyard_prices view with a product_id column next to
--     product_name, mirroring pricing.product_id, so the same
--     website_product_id -> products.id -> product_id chain works against the view
-- Additive only: one new products row, one new view column. No existing rows, tables,
-- functions, or policies are changed. The view must be dropped and recreated (not
-- replaced) because the new column is not appended at the end; grants are restored by
-- the schema's default privileges.

insert into public.products (name, category, dimensions, website_product_id)
values (
  'Heat Transfer (Dye Sublimation) Lanyard',
  'Lanyards & Holders',
  '1.5cm/2cm/2.5cm x 90cm',
  'ece775be-d6de-409f-a129-152d850dba26'
)
on conflict (name) do nothing;

drop view if exists public.heat_transfer_lanyard_prices;

create view public.heat_transfer_lanyard_prices as
with widths as (
  select unnest(array[15, 20, 25]) as width_mm
),
attachments as (
  select distinct c.attachment_type
    from public.lanyard_component_costs c
),
qty_grid as (
  select 'air'::text as freight_type,
         unnest(array[50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900,
                      1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]) as quantity
  union all
  select 'sea',
         unnest(array[500, 600, 700, 800, 900, 1000, 1500, 2000, 2500, 3000,
                      3500, 4000, 4500, 5000])
)
select
  (select pr.id from public.products pr
    where pr.name = 'Heat Transfer (Dye Sublimation) Lanyard') as product_id,
  'Heat Transfer (Dye Sublimation) Lanyard'::text as product_name,
  p.attachment_type,
  p.width_mm,
  p.size_label,
  p.freight_type,
  p.quantity,
  p.unit_price_sgd,
  p.total_price_sgd,
  p.currency,
  p.moq,
  p.lead_time_days_min,
  p.lead_time_days_max
from widths w
cross join attachments a
cross join qty_grid g
cross join lateral public.calculate_heat_transfer_lanyard_price(
  a.attachment_type, g.quantity, g.freight_type, w.width_mm
) p;

comment on view public.heat_transfer_lanyard_prices is
  'Live heat transfer (dye sublimation) lanyard pricelist for 1.5cm/2cm/2.5cm x 90cm (width_mm 15/20/25), SGD before GST. Computed on read from lanyard_* cost tables and global_overseas_pricing, so FX/cost updates apply immediately. product_id references the Heat Transfer (Dye Sublimation) Lanyard row in products (website_product_id ece775be-d6de-409f-a129-152d850dba26), mirroring pricing.product_id. Standard quantity tiers only; use calculate_heat_transfer_lanyard_price() for other quantities. Design charge add-on lives in lanyard_design_charges.';
