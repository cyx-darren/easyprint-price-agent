# Agent Instructions

The production Supabase project is `easyprint-price-agent-v1` (`qfurwggrguivmsynceux`). It is shared with other EasyPrint projects and is the system of record for pricing.

## Which Supabase Table For Which Product Pricing

The **Pricing Source Router** table near the top of `README.md` is the authoritative map from product/pricing question to Supabase table. Key routes:

- **Corporate gift catalogue prices, tiers, MOQ** -> `pricing` joined to `products`.
- **Custom heat transfer (dye sublimation) lanyards** (1.5cm/2cm/2.5cm x 90cm) -> the live view `heat_transfer_lanyard_prices` (filter `width_mm` 15/20/25), or `calculate_heat_transfer_lanyard_price(attachment, qty, freight, width_mm)` for off-grid quantities. These prices are **computed on read** from `lanyard_component_costs`, `lanyard_freight_costs`, `lanyard_profit_margins`, and `global_overseas_pricing` — never import computed lanyard selling prices as static rows; update the raw-input tables instead and prices follow automatically.
- **Paper print products** -> profit rule tables (`product_pricing_rules`, `booklet_pricing_rules`, ...) plus `paper_*` cost tables, not the gift `pricing` table.
- **Sample fees** -> `sample_pricing`.
- **Supplier print/decoration charges** -> `mygift_charges` / `sunprint_charges` / `plsilkscreen_charges` (+ `*_category_mappings`), `venue31_charges`.
- **Vendor `*_products` tables** (`mygift_products`, `fgconcept_products`, `thumbtech_products`, `ultifresh_products`, `orensport_products`, `dealers_fg_stock_balances`) hold **supplier costs and stock**, never customer-facing selling prices.
- **Quote benchmarking** -> `pricing_benchmark_*` snapshot tables (historical, not live margins).

## Data Safety

- The database is shared: make strictly additive changes only. Never update, delete, or alter existing tables, rows, functions, or policies belonging to other workflows.
- `public.pricing` may be written only when the task is explicitly a catalogue selling-price update.
- New tables ship with RLS enabled and no public policies unless explicitly decided otherwise.
- Prefer migrations for schema changes; import scripts default to dry-run and validate before writing.

## Documentation

Whenever changes are added to this project, update `README.md` in the same change if the update affects project behavior, setup, scripts, Supabase schema/tables, data import workflows, deployment, or repository structure. If a change adds or re-routes a pricing source, update the Pricing Source Router table in `README.md` and this file's summary above.

Keep `README.md` current enough that any future agent can quickly understand what this repo does, what each project-owned Supabase table is for, and how to use the project safely.
