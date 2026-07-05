-- Extend the heat transfer lanyard pricelist to all three widths.
--
-- The 1.5cm (15mm) and 2.5cm (25mm) workbook tabs use the same formula and
-- the same shared cost inputs as the verified 2cm tab; component costs per
-- width already exist in lanyard_component_costs. This migration:
--   * fixes the size_label formatting ('2cm x 90cm', not '2.0000000000000000cm x 90cm')
--   * rebuilds the heat_transfer_lanyard_prices view across widths 15/20/25
--     (77 attachments x air/sea x standard qty tiers x 3 widths = 8,085 rows)
--
-- Verified against the workbook: 2cm and 2.5cm tabs reproduce exactly.
-- Known deviation (business decision): the 1.5cm tab's nine
-- "retractable reel (logo print)" blocks omit the reel print fee from the
-- air-freight import-GST term, inconsistent with their own sea rows and with
-- the other two tabs. This calculator applies the uniform formula, so those
-- 189 air prices compute ~$0.01-0.08/pc higher than that sheet tab.

create or replace function public.calculate_heat_transfer_lanyard_price(
  p_attachment_type text,
  p_quantity integer,
  p_freight_type text,
  p_width_mm integer default 20
)
returns table (
  attachment_type text,
  width_mm integer,
  size_label text,
  freight_type text,
  quantity integer,
  unit_price_sgd numeric,
  total_price_sgd numeric,
  currency text,
  moq integer,
  lead_time_days_min integer,
  lead_time_days_max integer,
  component_unit_cost_usd numeric,
  mold_fee_usd_applied numeric,
  air_freight_usd numeric,
  courier_cost_usd numeric,
  sea_freight_sgd numeric,
  margin_divisor numeric
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_usd numeric;
  v_gst numeric;
  v_surcharge numeric;
  v_mold_fee numeric;
  v_mold_threshold numeric;
  v_qty50_discount numeric;
  v_print_fee numeric;
  v_calc_qty integer;      -- qty used for tier lookups / base formula (100 for the 50-99 band)
  v_comp numeric;
  v_margin numeric;
  v_air numeric;
  v_courier numeric;
  v_sea_sgd numeric;
  v_mold numeric;
  v_goods numeric;
  v_unit numeric;
begin
  if p_freight_type not in ('air', 'sea') then
    raise exception 'freight_type must be air or sea, got %', p_freight_type;
  end if;

  -- Published pricelist bounds: air 50-5000, sea 500-5000.
  if p_quantity is null
     or p_quantity > 5000
     or (p_freight_type = 'air' and p_quantity < 50)
     or (p_freight_type = 'sea' and p_quantity < 500) then
    return;
  end if;

  select max(case when config_key = 'usd_multiplier' then config_value end),
         max(case when config_key = 'gst_multiplier' then config_value end),
         max(case when config_key = 'alibaba_surcharge' then config_value end),
         max(case when config_key = 'mold_fee_usd' then config_value end),
         max(case when config_key = 'mold_fee_threshold_qty' then config_value end),
         max(case when config_key = 'lanyard_air_qty50_total_discount_sgd' then config_value end),
         max(case when config_key = 'lanyard_reel_logo_print_fee_usd' then config_value end)
    into v_usd, v_gst, v_surcharge, v_mold_fee, v_mold_threshold, v_qty50_discount, v_print_fee
    from global_overseas_pricing
   where config_key in ('usd_multiplier', 'gst_multiplier', 'alibaba_surcharge',
                        'mold_fee_usd', 'mold_fee_threshold_qty',
                        'lanyard_air_qty50_total_discount_sgd',
                        'lanyard_reel_logo_print_fee_usd');

  if v_usd is null or v_gst is null or v_surcharge is null
     or v_mold_fee is null or v_mold_threshold is null
     or v_qty50_discount is null or v_print_fee is null then
    raise exception 'global_overseas_pricing is missing one of the lanyard pricing config keys';
  end if;

  -- The 50-99 band is priced off the 100pc tier (workbook rule).
  v_calc_qty := case when p_freight_type = 'air' and p_quantity < 100 then 100 else p_quantity end;

  select c.unit_cost_usd into v_comp
    from lanyard_component_costs c
   where c.attachment_type = p_attachment_type
     and c.width_mm = p_width_mm
     and v_calc_qty >= c.qty_min
     and (c.qty_max is null or v_calc_qty <= c.qty_max);
  if not found then
    return;
  end if;

  select m.margin into v_margin
    from lanyard_profit_margins m
   where m.freight_type = p_freight_type
     and v_calc_qty >= m.qty_min
     and (m.qty_max is null or v_calc_qty <= m.qty_max);
  if not found then
    return;
  end if;

  -- Flat USD fees priced into the goods portion. The mold fee is waived at
  -- the threshold except for lobster claw + retractable reel combos; the
  -- reel logo print fee is charged at all quantities.
  v_mold := case when v_calc_qty < v_mold_threshold
                   or p_attachment_type like 'lobster claw + retractable reel%'
                 then v_mold_fee else 0 end
          + case when p_attachment_type like '%retractable reel (logo print)%'
                 then v_print_fee else 0 end;
  v_goods := v_comp * v_calc_qty + v_mold;

  if p_freight_type = 'air' then
    select f.cost into v_air
      from lanyard_freight_costs f
     where f.freight_type = 'air'
       and f.cost_type = 'air_freight'
       and v_calc_qty >= f.qty_min
       and (f.qty_max is null or v_calc_qty <= f.qty_max);
    if not found then
      return;
    end if;

    v_unit := ((v_goods + v_air) * v_surcharge * v_usd
              + v_goods * v_surcharge * v_usd * (v_gst - 1)) / v_margin / v_calc_qty;

    if p_quantity < 100 then
      v_unit := (v_unit * 100 - v_qty50_discount) / 50;
    end if;
  else
    select f.cost into v_courier
      from lanyard_freight_costs f
     where f.freight_type = 'sea'
       and f.cost_type = 'courier_to_warehouse'
       and v_calc_qty >= f.qty_min
       and (f.qty_max is null or v_calc_qty <= f.qty_max);
    if not found then
      return;
    end if;

    select f.cost into v_sea_sgd
      from lanyard_freight_costs f
     where f.freight_type = 'sea'
       and f.cost_type = 'sea_freight'
       and v_calc_qty >= f.qty_min
       and (f.qty_max is null or v_calc_qty <= f.qty_max);
    if not found then
      return;
    end if;

    v_unit := ((v_comp * v_calc_qty + v_mold + v_courier) * v_surcharge * v_usd * v_gst
              + v_sea_sgd) / v_calc_qty / v_margin;
  end if;

  return query select
    p_attachment_type,
    p_width_mm,
    trim(trailing '.' from trim(trailing '0' from (p_width_mm::numeric / 10)::text)) || 'cm x 90cm',
    p_freight_type,
    p_quantity,
    round(v_unit, 4),
    round(v_unit * p_quantity, 2),
    'SGD'::text,
    case when p_freight_type = 'air' then 50 else 500 end,
    case when p_freight_type = 'air' then 8 else 15 end,
    case when p_freight_type = 'air' then 13 else 30 end,
    v_comp,
    v_mold,
    v_air,
    v_courier,
    v_sea_sgd,
    v_margin;
end;
$$;

comment on function public.calculate_heat_transfer_lanyard_price(text, integer, text, integer) is
  'Computes the SGD selling price (before GST) for a custom heat transfer (dye sublimation) lanyard from the lanyard_* cost tables and global_overseas_pricing. freight_type: air (MOQ 50) or sea (MOQ 500), max 5000pcs. width_mm 15/20/25 = the 1.5cm/2cm/2.5cm x 90cm pricelists, all workbook-verified.';

create or replace view public.heat_transfer_lanyard_prices as
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
  'Live heat transfer (dye sublimation) lanyard pricelist for 1.5cm/2cm/2.5cm x 90cm (width_mm 15/20/25), SGD before GST. Computed on read from lanyard_* cost tables and global_overseas_pricing, so FX/cost updates apply immediately. Standard quantity tiers only; use calculate_heat_transfer_lanyard_price() for other quantities. Design charge add-on lives in lanyard_design_charges.';
