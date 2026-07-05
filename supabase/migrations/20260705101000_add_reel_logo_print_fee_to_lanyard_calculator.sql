-- Add the retractable reel logo print fee to the heat transfer lanyard
-- calculator.
--
-- In the workbook, every "retractable reel (logo print)" block prices in an
-- extra flat 15 USD reel print fee alongside the mold fee (the "+ 15 USD" in
-- the block labels). Below the mold threshold both fees apply; at or above
-- 3000 pcs the mold fee is waived but the print fee remains.
--
-- Known workbook inconsistency, deliberately NOT replicated: the single
-- "lobster claw + retractable reel (logo print)" block keeps the mold fee at
-- >= 3000 pcs while all eight other logo-print blocks drop it. This
-- calculator applies the consistent rule, so that one variant prices ~0.007
-- SGD/pc lower than the workbook at 3000-5000 pcs.

insert into public.global_overseas_pricing (config_key, config_value, description)
select 'lanyard_reel_logo_print_fee_usd', 15,
       'Flat USD print fee added for retractable reel (logo print) lanyard variants; applies at all quantities'
where not exists (
  select 1 from public.global_overseas_pricing
  where config_key = 'lanyard_reel_logo_print_fee_usd'
);

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

  -- Flat USD fees priced into the goods portion: mold fee waived at the
  -- threshold, reel logo print fee charged at all quantities.
  v_mold := case when v_calc_qty < v_mold_threshold then v_mold_fee else 0 end
          + case when p_attachment_type like '%retractable reel (logo print)%' then v_print_fee else 0 end;
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
    (p_width_mm::numeric / 10)::text || 'cm x 90cm',
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
