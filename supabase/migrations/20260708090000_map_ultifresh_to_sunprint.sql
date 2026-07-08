-- Wire Ultifresh products to SUNPRINT print charges.
-- 1) Fill the manual categories/subcategories fields on ultifresh_products by series-code prefix.
-- 2) Add ULTIFRESH-scoped mapping rows to sunprint_category_mappings.
-- Mapping decisions confirmed by Darren 2026-07-08:
--   default print method silkscreen 1c x 1p; hoodies/jackets/windbreakers and
--   blazers/pants/skirts -> coverall_worker_jacket; caps/hats -> cap (DTF only).

-- Step 1: classify Ultifresh products (only rows still unclassified).
with prefixed as (
    select id,
           product_name,
           substring(upper(item_code) from '^[A-Z]+') as alpha_prefix
    from public.ultifresh_products
    where categories is null
)
update public.ultifresh_products up
set categories = case
        when p.alpha_prefix in ('UDF','UDP','UH','UCP','USP','UOV','UDM','URS',
                                'TCS','FTS','ACS','FTL','BPT','BCL','BCK','BCR','BCRG')
            then 'Apparel Tops'
        when p.alpha_prefix in ('UHD','UVJ','AKJ') then 'Outerwear & Jackets'
        when p.alpha_prefix in ('CBM','PAT','SKT') then 'Corporate Tailoring'
        when p.alpha_prefix in ('BCP','BFH') then 'Caps & Hats'
        when p.alpha_prefix = 'APR' then 'Aprons'
        when p.alpha_prefix in ('UBTW','USTW') then 'Towels'
    end,
    subcategories = case
        when p.alpha_prefix in ('UDF','UDP','UH','UCP','USP','UOV','UDM','URS',
                                'TCS','FTS','ACS','FTL','BPT','BCL','BCK','BCR','BCRG') then
            case
                when p.product_name ilike '%polo%' then 'Polo T-Shirts'
                when p.product_name ilike '%singlet%' then 'Singlets'
                when p.product_name ilike '%sports shorts%' then 'Shorts'
                when p.product_name ilike '%sweat shirt%' or p.product_name ilike '%sweatshirt%' then 'Sweatshirts'
                when p.product_name ilike '%corporate%' or p.product_name ilike '%oxford%'
                     or p.product_name ilike '%anti-wrinkle%' or p.product_name ilike '%muslimah%' then 'Corporate Shirts'
                else 'T-Shirts'
            end
        when p.alpha_prefix in ('UHD','UVJ','AKJ') then
            case when p.product_name ilike '%hoodie%' then 'Hoodies' else 'Jackets' end
        when p.alpha_prefix in ('CBM','PAT','SKT') then
            case
                when p.product_name ilike '%blazer%' then 'Blazers'
                when p.product_name ilike '%pant%' then 'Pants'
                when p.product_name ilike '%skirt%' then 'Skirts'
                else 'Corporate Tailoring'
            end
        when p.alpha_prefix in ('BCP','BFH') then
            case when p.product_name ilike '%cap%' then 'Baseball Caps' else 'Hats' end
        when p.alpha_prefix = 'APR' then 'Aprons'
        when p.alpha_prefix in ('UBTW','USTW') then 'Towels'
    end,
    updated_at = now()
from prefixed p
where up.id = p.id
  and p.alpha_prefix in ('UDF','UDP','UH','UCP','USP','UOV','UDM','URS',
                         'TCS','FTS','ACS','FTL','BPT','BCL','BCK','BCR','BCRG',
                         'UHD','UVJ','AKJ','CBM','PAT','SKT','BCP','BFH',
                         'APR','UBTW','USTW');

-- Step 2: ULTIFRESH-scoped SUNPRINT mapping rows (idempotent inserts).
insert into public.sunprint_category_mappings
    (product_category, supplier_name, sunprint_product_category,
     default_print_method, default_print_spec, mapping_type, priority, is_active, notes)
select v.product_category, 'ULTIFRESH', v.sunprint_product_category,
       v.default_print_method, v.default_print_spec, 'product_category', 50, true, v.notes
from (values
    ('Apparel Tops', 'tshirt', 'silkscreen', '1c x 1p',
     'Confirmed by Darren 2026-07-08: Ultifresh tees, polos, singlets, sports shorts, sweatshirts, and corporate shirts use SUNPRINT tshirt charges; default silkscreen 1c x 1p, DTF tiers available on request.'),
    ('Outerwear & Jackets', 'coverall_worker_jacket', 'silkscreen', '1c x 1p',
     'Confirmed by Darren 2026-07-08: Ultifresh hoodies, jackets, and windbreakers (UHD/UVJ/AKJ) use SUNPRINT coverall/worker jacket charges; default silkscreen 1c x 1p.'),
    ('Corporate Tailoring', 'coverall_worker_jacket', 'silkscreen', '1c x 1p',
     'Confirmed by Darren 2026-07-08: Ultifresh blazers, pants, and skirts (CBM/PAT/SKT) price via SUNPRINT coverall/worker jacket charges; default silkscreen 1c x 1p.'),
    ('Caps & Hats', 'cap', 'dtf', '1 position',
     'Confirmed by Darren 2026-07-08: Ultifresh caps and hats (BCP/BFH) map to SUNPRINT cap DTF charges only; no silkscreen cap mapping.'),
    ('Aprons', 'bag_towel_arm_sleeve_vest_apron', 'silkscreen', '1c x 1p',
     'Confirmed by Darren 2026-07-08: Ultifresh aprons (APR) use SUNPRINT Bag / Towel / Arm Sleeve / Vest / Apron charges; default silkscreen 1c x 1p.'),
    ('Towels', 'bag_towel_arm_sleeve_vest_apron', 'silkscreen', '1c x 1p',
     'Confirmed by Darren 2026-07-08: Ultifresh towels (UBTW/USTW) use SUNPRINT Bag / Towel / Arm Sleeve / Vest / Apron charges; default silkscreen 1c x 1p.')
) as v(product_category, sunprint_product_category, default_print_method, default_print_spec, notes)
where not exists (
    select 1 from public.sunprint_category_mappings m
    where m.supplier_name = 'ULTIFRESH'
      and m.product_category = v.product_category
      and m.mapping_type = 'product_category'
);
