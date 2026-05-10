# EasyPrint Price Agent

Price Agent is EasyPrint's pricing lookup service for corporate gifts and print products. It exposes an Express API, a Discord `!price` bot, import utilities, and Supabase migrations/data used by agents that need reliable selling prices, MOQ checks, sample pricing, supplier print charges, and benchmark margin snapshots.

The production Supabase project is `easyprint-price-agent-v1` (`qfurwggrguivmsynceux`). Treat the database as the system of record. Do not overwrite pricing data unless the task is explicitly a catalogue price update.

## What This Repo Contains

| Path | Purpose |
| --- | --- |
| `backend/` | Express API used by the orchestrator and Discord bot. Pricing routes live in `backend/src/routes/pricing.js`; Supabase access is configured in `backend/src/services/supabase.js`. |
| `discord-bot/` | Discord bot for direct staff pricing lookups with `!price`. |
| `scripts/` | Import and generation utilities for catalogue pricing, supplier charge tables, and benchmark snapshots. |
| `supabase/migrations/` | Database schema changes for tables owned by this project. |
| `supabase/seed/` | SQL seed files for data-heavy reference tables. |
| `imported_pricing/` | Historical source CSV for corporate gift pricing imports. |
| `docs/` | Older PRD and import guides. Use this README as the current quick-start map. |

## Runtime Setup

Backend:

```bash
cd backend
npm install
npm run dev
```

Discord bot:

```bash
cd discord-bot
npm install
npm start
```

Required environment variables are stored outside Git. Do not commit `.env` files.

Backend expects:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY`
- `PRICE_AGENT_API_KEY`

Discord bot expects:

- Discord bot token/config
- Price Agent API base URL/key

## Data Safety Rules For Agents

- `public.pricing` is the core selling-price table. Do not run `update`, `delete`, `truncate`, destructive `alter`, or broad `upsert` against it unless the user explicitly asks to change catalogue selling prices.
- Additive data should use sidecar tables. Example: benchmark profit/cost snapshots live in `pricing_benchmark_*`, not as extra columns on `pricing`.
- Import scripts should validate row counts, IDs, headers, and source/destination checksums before writing.
- Prefer migrations for schema changes. Keep generated local Supabase state such as `supabase/.temp/` out of Git.
- Many database tables are intentionally operational/reference data. Check RLS policies before exposing anything through browser clients.

## Key Workflows

### Catalogue Price Lookup

Use `pricing` joined to `products` for product, print option, lead time, quantity tier, unit price, currency, and MOQ logic. API lookup code lives mainly in:

- `backend/src/services/productSearch.js`
- `backend/src/services/priceQuery.js`
- `backend/src/routes/pricing.js`

### Benchmark Profit Snapshots

Benchmark data from Google Sheet columns N:AD is stored in:

- `pricing_benchmark_snapshot_batches`
- `pricing_benchmark_snapshots`

These are historical quoting benchmarks, not live recalculated margins. Use them when quoting new/custom products by benchmarking against similar catalogue products. Existing `pricing` rows remain unchanged.

### Supplier Print Charge References

Supplier-specific print charge tables model external vendors' print costs and mapping rules:

- `mygift_charges`, `mygift_category_mappings`
- `sunprint_charges`, `sunprint_category_mappings`
- `plsilkscreen_charges`, `plsilkscreen_category_mappings`

Use mapping tables to decide which charge schedule applies to a product/category/supplier code, then use the charge tables for quantity tiers and charge amounts.

### Paper Product Pricing

Paper print products use rule tables and cost tables rather than the corporate gift `pricing` table. Use product/rule tables for profit rules and `paper_*` tables for material/finishing costs.

## Supabase Table Catalog

This catalog describes the public tables currently used by the `easyprint-price-agent-v1` Supabase project. Row counts change over time; purpose and usage are the important parts.

### Core Product And Selling Price Tables

| Table | Purpose | How agents should use it |
| --- | --- | --- |
| `products` | Unique product catalogue entries with name, category, dimensions, material, and color. | Use for product identity and category metadata. Product names are unique and referenced by `pricing.product_id` where available. |
| `pricing` | Core corporate gift selling price tiers by product, print option, lead time, quantity, unit price, currency, and MOQ flag. | Primary table for customer-facing price lookups. Match by product/print/lead time, then choose the applicable quantity tier. Do not store cost/profit snapshot fields here. |
| `pricing_benchmark_snapshot_batches` | One row per imported benchmark snapshot batch, including snapshot date and source sheet metadata. | Use to identify which historical benchmark set to apply, such as `2026-05-10`. |
| `pricing_benchmark_snapshots` | Per-`pricing.id` benchmark cost/profit snapshot rows from Google Sheet columns N:AD. | Use for quoting benchmark logic. Contains product source, print vendor source, item/print costs, benchmark profit amount, benchmark profit percentage, optional preferred basis, and raw source values. |
| `sample_pricing` | Sample pricing rules for physical/photo samples, including fixed/free/supplier-check modes, lead-time guidance, waiver/refund/design-change policies. | Use when answering sample cost and policy questions. Public read policy returns active rows. |

### Generic Pricing Rule Tables

| Table | Purpose | How agents should use it |
| --- | --- | --- |
| `pricing_size_tiers` | Named size tiers with maximum area thresholds and display labels. | Use to classify product dimensions into pricing size tiers. |
| `product_pricing_rules` | Generic paper/product pricing profit rules by product type, paper type, size tier, sides, and quantity range. | Use for non-catalogue paper/product quote calculations. |
| `booklet_pricing_rules` | Booklet profit rules by product type, size, page count, inner colour, and quantity range. | Use for booklet quote calculation after identifying size/page/colour attributes. |
| `folded_brochure_pricing_rules` | Folded brochure profit rules by paper type, size tier, fold type, and quantity range. | Use for folded brochure quote calculations. |
| `greeting_card_pricing_rules` | Greeting card profit rules by paper type, size tier, profit type/value, and quantity range. | Use for greeting card pricing calculations. |
| `global_overseas_pricing` | Global overseas pricing config values. | Use as shared overseas-pricing constants where applicable. |

### Paper, Print, And Finishing Cost Tables

| Table | Purpose | How agents should use it |
| --- | --- | --- |
| `paper_prices` | Standard paper stocks with sheet/packet prices, sheet dimensions, packet counts, and common-stock flags. | Use for material cost inputs for standard paper products. |
| `oversized_paper_prices` | Oversized paper stocks with sheet/packet costs and sheet dimensions. | Use when the required print size exceeds standard paper assumptions. |
| `paper_print_settings` | Numeric configuration values for paper print calculations. | Use as constants/settings in formula-driven paper pricing. |
| `paper_print_standard_sizes` | Standard size names with width/height in millimetres. | Use to normalize paper dimensions before pricing. |
| `paper_print_folding_prices` | Folding finishing prices by fold type and quantity range. | Add folding costs to flyers/brochures where requested. |
| `paper_print_lamination_prices` | Lamination prices by lamination type and quantity range. | Add lamination finishing costs. |
| `paper_print_binding_prices` | Binding costs by binding type and quantity range, with per-unit or flat-price support. | Use for booklet/binding quote additions. |
| `paper_print_namecard_cutting_prices` | Namecard cutting prices by quantity range. | Add cutting costs for namecard-style products. |
| `paper_print_hotstamping_prices` | Base hotstamping fee settings for simple hotstamping calculations. | Use for legacy/simple hotstamping calculations. |
| `paper_print_hotstamping_tiered_prices` | Tiered hotstamping charges by type, quantity range, block fee, per-piece price, and product type. | Use for red packet and related tiered hotstamping. |
| `paper_print_redpacket_spotuv_prices` | Red packet spot UV pricing by spot UV type and quantity range. | Add spot UV finishing costs for red packets. |
| `paper_print_redpacket_embossing_prices` | Red packet embossing pricing by emboss type and quantity range. | Add embossing finishing costs for red packets. |
| `paper_print_scoring_prices` | Scoring prices by product type and quantity range. | Add scoring costs for tent cards or other scored products. |
| `paper_print_tape_pasting_prices` | Tape-pasting prices by product type and quantity range; supports flat fee or per-piece price. | Add tape-pasting costs for folders, holders, red packets, and similar paper products. |
| `paper_print_diecut_prices` | Die-cut prices by product type and quantity range; supports flat fee or per-piece price. | Add die-cut costs for custom-shaped paper products. |
| `paper_print_velvet_lamination_prices` | Velvet lamination prices by quantity range. | Add velvet lamination costs where requested. |
| `paper_print_perforation_prices` | Perforation prices by product type and quantity range. | Add perforation finishing costs for coupons or similar products. |

### Supplier Charge And Mapping Tables

| Table | Purpose | How agents should use it |
| --- | --- | --- |
| `mygift_charges` | MYGIFT print charge rules parsed from the OSSG Gift Rev01 workbook. Includes charge names, item codes, print method/spec, quantity tiers, charge type, amount, unit, GST/source metadata, and active flag. | Use to estimate MYGIFT print charges after choosing the correct charge group and quantity tier. |
| `mygift_category_mappings` | Rules mapping products/categories/supplier codes to MYGIFT charge names and default print assumptions. | Resolve product/category/supplier-code inputs to a MYGIFT charge schedule before reading `mygift_charges`. |
| `sunprint_charges` | SUNPRINT charge rules by charge group, product category, print method/spec, position, size label, quantity range, charge type, amount, and source doc. | Use for SUNPRINT print cost calculations. |
| `sunprint_category_mappings` | Mapping rules from products/categories/supplier codes/size thresholds to SUNPRINT product categories and defaults. | Resolve catalogue products to SUNPRINT charge rows. |
| `plsilkscreen_charges` | PL Silkscreen charge rules by product category, print method, position type, size constraints, colour count, quantity range, charge type, and amount. | Use for PL Silkscreen and pad-printing cost calculations. |
| `plsilkscreen_category_mappings` | Mapping rules from products/categories/supplier codes/colours/urgency/size to PL Silkscreen product categories and defaults. | Resolve product context to PL Silkscreen charge rows. |

### Lanyard Pricing Tables

| Table | Purpose | How agents should use it |
| --- | --- | --- |
| `lanyard_component_costs` | Component unit costs in USD by attachment type, width, and quantity range. | Use as base component costs for lanyard quote calculations. |
| `lanyard_freight_costs` | Freight costs by freight type, cost type, quantity range, currency. | Add air/sea or other freight costs to lanyard quotes. |
| `lanyard_profit_margins` | Lanyard margin rules by freight type and quantity range. | Apply the appropriate margin after costs are calculated. |
| `lanyard_sea_freight_packaging` | Carton dimensions, CBM, and units per carton for sea freight packaging. | Use for sea freight volume and cartonization assumptions. |
| `lanyard_design_charges` | Design charges by quantity range. | Add design fees where relevant. |

### Shipping, Packaging, And Shared Config

| Table | Purpose | How agents should use it |
| --- | --- | --- |
| `shipping_config` | Shared numeric shipping configuration values. | Use as shipping constants in pricing calculations. |
| `packaging_defaults` | Default carton dimensions, weights, and units per carton by category/subcategory. | Estimate packaging and logistics when product-specific packaging is unavailable. |
| `exchange_rates` | Currency conversion rates with source and fetched timestamp. | Convert supplier costs between currencies; verify recency for high-stakes quotes. |

### Sourcing And Supplier Research Tables

| Table | Purpose | How agents should use it |
| --- | --- | --- |
| `quarry_product_search_terms` | Chinese search terms and success metrics for product sourcing. | Use to generate or reuse sourcing search terms. |
| `quarry_sourced_quotes` | Quotes scraped or confirmed from suppliers, including supplier data, product specs, unit prices, MOQs, chat status, packaging, and expiry. | Use as supplier quote evidence for sourced/custom products. Check expiry and confirmation status. |
| `quarry_source_comparisons` | Comparison records across multiple sourced quotes, including recommendation and exchange-rate-derived SGD values. | Use when selecting/recommending among sourced supplier options. |
| `quarry_conversations` | Supplier conversation messages tied to quote/comparison records, with extracted price/MOQ/lead-time data. | Use to audit supplier communications and confirmed details. |
| `quarry_suppliers` | Supplier profile/status records for Quarry sourcing. | Use for supplier metadata, contact history, and reliability context. |
| `weaver_suppliers` | Supplier profiles for Weaver workflows, including WeChat IDs and product categories. | Use for Weaver supplier contact context. |
| `weaver_conversations` | Weaver conversation logs with quote-related extracted fields. | Use to audit Weaver supplier chats and extracted quote data. |

## Import Scripts

| Script | Purpose |
| --- | --- |
| `scripts/importData.js` | Historical corporate gift pricing CSV import into `products` and `pricing`. |
| `scripts/parseAndGenerateSQL.js` | Parses the historical pricing CSV and emits JSON/SQL helper output. |
| `scripts/generatePricingSQL.js`, `scripts/generateBulkSQL.js`, `scripts/generateSmallBatchSQL.js` | Legacy SQL generation helpers for pricing inserts. |
| `scripts/generate_mygift_charges_seed.py` | Parses the MYGIFT XLSX print guide and generates `supabase/seed/mygift_charges_seed.sql`. |
| `scripts/import_mygift_charges_to_supabase.py` | Direct MYGIFT charge importer using Supabase REST credentials from `backend/.env`. |
| `scripts/import_pricing_benchmark_snapshots.rb` | Guarded importer for Google Sheet columns N:AD into the benchmark snapshot tables. Validates headers, row count, unique IDs, and A:M digest before writing. |

## Recent Supabase Additions

- `20260508062909_create_mygift_charges.sql` creates MYGIFT charge and mapping tables.
- `20260510164052_create_pricing_benchmark_snapshots.sql` creates benchmark snapshot batch/detail tables.
- The first benchmark snapshot batch imported from the Google Sheet is dated `2026-05-10` and contains `12,806` rows.

## Useful Checks

Before any import that references `pricing`, verify row count and identity:

```sql
select count(*) from public.pricing;
```

For benchmark snapshot integrity:

```sql
select b.snapshot_date, b.source_row_count, count(s.id) as snapshot_rows
from public.pricing_benchmark_snapshot_batches b
left join public.pricing_benchmark_snapshots s on s.snapshot_batch_id = b.id
group by b.id;
```

Check for orphaned benchmark rows:

```sql
select count(*)
from public.pricing_benchmark_snapshots s
left join public.pricing p on p.id = s.pricing_id
where p.id is null;
```
