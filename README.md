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

### MYGIFT Live Product Catalogue

MYGIFT portal product scrape data is stored separately from the core `products` and `pricing` tables:

- `mygift_products` keeps the latest known item code, unit cost, description, image URL, stock status, decoration methods, and manual `categories` / `subcategories` fields.
- `mygift_product_snapshots` keeps per-run history so daily stock changes and yearly price changes remain auditable.
- `mygift_product_scrape_runs` records scrape run status, counts, failures, and metadata.

The scraper only writes these MYGIFT-owned tables. It must not update existing shared tables such as `products`, `pricing`, `mygift_charges`, or `mygift_category_mappings`.

### FGCONCEPT Product Catalogue

FGCONCEPT product scrape data is stored separately from the core `products` and `pricing` tables:

- `fgconcept_products` keeps the latest known item code, unit cost, description, image URL, stock status, decoration methods, and manual `categories` / `subcategories` fields.
- `fgconcept_product_snapshots` keeps per-run history so stock changes and price changes remain auditable.
- `fgconcept_product_scrape_runs` records scrape run status, counts, failures, and metadata.

FGCONCEPT imports must write only these FGCONCEPT-owned tables and must not update shared catalogue or pricing tables. The stock sheet has multiple variants under the same vendor item code, so imports use synthetic variant item codes such as `FG-07::hand-towel-green`; the vendor-original item code is preserved in `series_code` and `raw_product.original_item_code`.

### ThumbTech Product Catalogue

ThumbTech PDF stock and price list data is stored separately from the core `products` and `pricing` tables:

- `thumbtech_products` keeps the latest non-clearance item/SKU rows, including product details, unit cost, product-band image URL, current stock level, reserved quantity, available stock quantity, incoming stock batches, decoration methods, and manual `categories` / `subcategories` fields.
- `thumbtech_product_snapshots` keeps per-run history so daily stock changes and future price list changes remain auditable.
- `thumbtech_product_scrape_runs` records import status, counts, skipped clearance products, failures, source PDFs, and metadata.

ThumbTech imports must write only these ThumbTech-owned tables and the `thumbtech-product-images` storage bucket. Product bands marked `CLEARANCE` are excluded because the supplier is phasing them out. `COMING SOON` quantities are stored in `incoming_stock`; current warehouse stock comes only from the PDF `STOCK LEVEL` column.

### Ultifresh Product Catalogue

Ultifresh agent price-list PDF data is stored separately from the core `products` and `pricing` tables:

- `ultifresh_products` keeps the latest known design group, product name, series code, normalized item code, normal agent unit price, optional MA promo price, assumed stock status, source catalog page range, and manual `categories` / `subcategories` fields.
- `ultifresh_product_snapshots` keeps per-run history so future price-list changes remain auditable.
- `ultifresh_product_import_runs` records import status, source file, row counts, errors, and metadata.

Ultifresh imports must write only these Ultifresh-owned tables and must not update shared catalogue or pricing tables. The current PDF has no real stock quantities, so imports set `stock_status` to `assumed_in_stock` and leave `stock_quantity` null.

### Dealers FG Stock Sheet

Dealers FG stock data from the approved Google Sheet is stored separately from catalogue pricing:

- `dealers_fg_stock_balances` keeps the latest known stock balance and dealer price by item code and variant.
- `dealers_fg_stock_snapshots` keeps per-run stock history for auditability.
- `dealers_fg_stock_import_runs` records import status, source sheet metadata, and parse counts.

The importer uses an already-authenticated Chrome DevTools tab to read the shared Google Sheet CSV endpoint. It is manual-only by default and must not write any shared pricing tables.

### OrenSport Agent Price Catalogue

OrenSport agent-price PDF data is stored in `orensport_products`. It is an isolated vendor table for item series/code, sizes, agent unit price, combined 4XL/5XL/7XL price, product details, remarks, and later manual `category` / `subcategory` fields.

The PDF importer splits slash-separated item-series cells into individual rows and keeps all price variants, including regular, promotion, WSL, new, and new-size rows. It does not write any shared pricing tables.

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
| `mygift_products` | Latest current-state MYGIFT portal product rows by supplier item code, including series code, unit cost, description, image URL, stock status/quantity, decoration methods, active flag, and manual `categories` / `subcategories`. | Use for MYGIFT catalogue availability and supplier-cost context. Do not delete phased-out items; inactive rows preserve historical product identity. |
| `mygift_product_snapshots` | Historical MYGIFT product scrape snapshots tied to a scrape run. | Use to audit stock and item price changes over time. |
| `mygift_product_scrape_runs` | Audit table for MYGIFT scrape runs, including status, counts, failed series, and run metadata. | Check this before trusting the latest scrape; only successful full runs should drive current availability decisions. |
| `fgconcept_products` | Latest current-state FGCONCEPT product rows by supplier item code, including series code, unit cost, description, image URL, stock status/quantity, decoration methods, active flag, and manual `categories` / `subcategories`. | Use for FGCONCEPT catalogue availability and supplier-cost context. Do not delete phased-out items; inactive rows preserve historical product identity. |
| `fgconcept_product_snapshots` | Historical FGCONCEPT product scrape snapshots tied to a scrape run. | Use to audit stock and item price changes over time. |
| `fgconcept_product_scrape_runs` | Audit table for FGCONCEPT scrape runs, including status, counts, failed series, and run metadata. | Check this before trusting the latest scrape; only successful full runs should drive current availability decisions. |
| `thumbtech_products` | Latest current-state ThumbTech PDF product rows by item/SKU, excluding clearance bands. Includes parsed product details, unit cost, image URL, current stock level, reserved quantity, available stock, incoming stock JSON, decoration methods, active flag, and manual `categories` / `subcategories`. | Use for ThumbTech catalogue availability and supplier-cost context. `COMING SOON` is future incoming stock, not current stock. Full imports mark missing rows inactive instead of deleting them. |
| `thumbtech_product_snapshots` | Historical ThumbTech PDF product snapshots tied to an import run. | Use to audit current stock, reserved quantity, incoming stock, and price changes over time. |
| `thumbtech_product_scrape_runs` | Audit table for ThumbTech PDF imports, including source files, status, counts, skipped clearance count, and run metadata. | Check this before trusting the latest ThumbTech import; only successful full runs should drive current availability decisions. |
| `ultifresh_products` | Latest current-state Ultifresh PDF price-list rows by normalized item code. Includes design group, design number, product name, series code, normal agent price, optional MA promo price, assumed stock status, active flag, and manual `categories` / `subcategories`. | Use for Ultifresh supplier-cost lookup. Stock is assumed available because the source PDF does not provide stock quantities. Full imports mark missing rows inactive instead of deleting them. |
| `ultifresh_product_snapshots` | Historical Ultifresh product price-list snapshots tied to an import run. | Use to audit future price-list changes over time. |
| `ultifresh_product_import_runs` | Audit table for Ultifresh PDF imports, including source file, status, row counts, and metadata. | Check this before trusting the latest Ultifresh import. |
| `dealers_fg_stock_balances` | Latest Dealers FG stock balance rows by supplier item code and variant, including dealer price, source row, active flag, and raw source values. | Use for current stock availability and supplier-cost context for the Dealers FG sheet. Full imports mark missing rows inactive instead of deleting them. |
| `dealers_fg_stock_snapshots` | Historical Dealers FG stock rows tied to an import run. | Use to audit stock changes over time. |
| `dealers_fg_stock_import_runs` | Audit table for Dealers FG stock imports, including source sheet metadata, status, and parse counts. | Check this before trusting the latest imported stock balances. |
| `orensport_products` | OrenSport agent price rows parsed from the Singapore PDF price list. Includes split item series codes, raw PDF item-code cell, sizes, agent price, combined 4XL/5XL/7XL price, product details, price variant, source page/row, and manual category fields. | Use for OrenSport supplier-cost lookup. Preserve duplicate item-series rows when they represent promotion or WSL variants. |
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
| `scripts/scrape_mygift_products_to_supabase.py` | Logs in to the MYGIFT calculator portal, scrapes live item codes/unit costs/descriptions/image URLs/stock/decoration methods, and imports only to `mygift_products`, `mygift_product_snapshots`, and `mygift_product_scrape_runs`. Defaults to dry-run; pass `--commit` to write. |
| `scripts/scrape_dealers_fg_stock_to_supabase.js` | Reads the approved Dealers FG Google Sheet through an authenticated Chrome DevTools tab, parses stock balances, and imports only to `dealers_fg_stock_balances`, `dealers_fg_stock_snapshots`, and `dealers_fg_stock_import_runs`. Defaults to dry-run; pass `--commit` to write. |
| `scripts/import_fgconcept_products_from_sheet.js` | Reads the approved FGCONCEPT Google Sheet through an authenticated Chrome DevTools tab and imports synthetic variant product rows only to `fgconcept_products`, `fgconcept_product_snapshots`, and `fgconcept_product_scrape_runs`. Defaults to dry-run; pass `--commit` to write. |
| `scripts/import_thumbtech_products_from_pdf.py` | Parses the local ThumbTech Drinkware and Gadget PDFs with PyMuPDF, uploads product-band images, and imports only to `thumbtech_products`, `thumbtech_product_snapshots`, `thumbtech_product_scrape_runs`, and the `thumbtech-product-images` storage bucket. Defaults to dry-run; pass `--commit` to write. |
| `scripts/import_ultifresh_products_from_pdf.py` | Parses `/Users/darrenchoong/Downloads/Ultifresh SG -- Normal Agent Price list - 2025.pdf` with PyMuPDF and imports only to `ultifresh_products`, `ultifresh_product_snapshots`, and `ultifresh_product_import_runs`. Defaults to dry-run; pass `--commit` to write. |
| `scripts/import_orensport_agent_prices.py` | Parses `/Users/darrenchoong/Downloads/ORENSPORT_AGENT_SG.pdf` with PyMuPDF and imports rows only to `orensport_products`. Defaults to dry-run; pass `--commit` to write. |
| `scripts/import_pricing_benchmark_snapshots.rb` | Guarded importer for Google Sheet columns N:AD into the benchmark snapshot tables. Validates headers, row count, unique IDs, and A:M digest before writing. |

## Recent Supabase Additions

- `20260508062909_create_mygift_charges.sql` creates MYGIFT charge and mapping tables.
- `20260510164052_create_pricing_benchmark_snapshots.sql` creates benchmark snapshot batch/detail tables.
- `20260512162000_create_mygift_products.sql` creates isolated MYGIFT live product scrape tables.
- `20260513090000_create_dealers_fg_stock_tables.sql` creates isolated Dealers FG stock sheet import tables.
- `20260513003000_create_orensport_products.sql` creates the isolated OrenSport agent-price table.
- `20260513103000_create_fgconcept_products.sql` creates isolated FGCONCEPT product scrape tables.
- `20260513133000_create_thumbtech_products.sql` creates isolated ThumbTech PDF product import tables.
- `20260513133500_prepare_thumbtech_import_access.sql` creates the ThumbTech image bucket and scoped temporary import policies for controlled anon-key imports.
- `20260513134000_remove_thumbtech_import_access.sql` removes the scoped temporary ThumbTech import policies after the controlled import.
- `20260513150000_create_ultifresh_products.sql` creates isolated Ultifresh PDF product import tables.
- `20260513150500_prepare_ultifresh_import_access.sql` creates scoped temporary import policies for controlled anon-key Ultifresh imports.
- `20260513151000_remove_ultifresh_import_access.sql` removes the scoped temporary Ultifresh import policies after the controlled import.
- The first benchmark snapshot batch imported from the Google Sheet is dated `2026-05-10` and contains `12,806` rows.

## MYGIFT Product Scrape

The MYGIFT live product scraper requires a real Supabase `service_role` key in `backend/.env` as `SUPABASE_SERVICE_KEY` and MYGIFT portal credentials via environment variables or CLI flags. Do not commit credentials. The script refuses `--commit` with an anon/publishable key unless `--allow-non-service-key` is explicitly passed during a controlled maintenance window.

Dry-run a known series:

```bash
MYGIFT_USERNAME='...' MYGIFT_PASSWORD='...' \
python3 scripts/scrape_mygift_products_to_supabase.py --codes AM09
```

Dry-run a small portal sample:

```bash
MYGIFT_USERNAME='...' MYGIFT_PASSWORD='...' \
python3 scripts/scrape_mygift_products_to_supabase.py --limit 10
```

Run the production import:

```bash
MYGIFT_USERNAME='...' MYGIFT_PASSWORD='...' \
python3 scripts/scrape_mygift_products_to_supabase.py --commit
```

Safety rules:

- The script writes only `mygift_products`, `mygift_product_snapshots`, and `mygift_product_scrape_runs`.
- Full successful runs mark missing MYGIFT products inactive instead of deleting them.
- `categories` and `subcategories` are reserved for later manual enrichment and are preserved during upserts.
- Image handling is URL-only; the scraper does not download portal images.
- If the project only has an anon key locally, replace it with a service-role key before normal imports. Do not loosen RLS or policies on existing shared tables.

## Dealers FG Stock Sheet Import

The Dealers FG importer requires a Chrome window launched with DevTools enabled and signed in to the Gmail account that has access to the shared Sheet. It uses the approved Sheet URL and gid by default. Do not commit Chrome profiles or credentials.

Launch a temporary Chrome profile:

```bash
open -na 'Google Chrome' --args \
  --user-data-dir=/private/tmp/price-agent-sheet-chrome \
  --remote-debugging-port=9333 \
  --no-first-run \
  --no-default-browser-check \
  'https://docs.google.com/spreadsheets/d/10tsMLZTUNoaB_dYYfhDfLMhLYQkoPjG_yAoVJ_soXBA/edit?gid=485920976#gid=485920976'
```

After signing in and confirming the Sheet grid is visible, dry-run a small parse:

```bash
node scripts/scrape_dealers_fg_stock_to_supabase.js --limit-rows 40
```

Run the production import:

```bash
node scripts/scrape_dealers_fg_stock_to_supabase.js --commit
```

Safety rules:

- The script writes only `dealers_fg_stock_balances`, `dealers_fg_stock_snapshots`, and `dealers_fg_stock_import_runs`.
- Dry-run is the default. `--commit` requires `SUPABASE_URL` and a real Supabase `service_role` key from `backend/.env` or the environment.
- Full successful imports mark missing previously active rows inactive instead of deleting them. `--limit-rows` is treated as a partial import and does not mark rows inactive.
- The importer validates the first stock columns: `Item Code`, `Product Descriptions`, `Dealers`, `Balance`, `IN`, `OUT`, `Balance`.

## FGCONCEPT Product Import

The FGCONCEPT importer reads the same approved Google Sheet through a Chrome window launched with DevTools enabled and signed in to the Gmail account that has access to the shared Sheet. It maps stock variants into MYGIFT-style product rows by using synthetic item codes in the form `original-item-code::slugified-variant-key`.

Launch a temporary Chrome profile if one is not already running:

```bash
open -na 'Google Chrome' --args \
  --user-data-dir=/private/tmp/price-agent-sheet-chrome \
  --remote-debugging-port=9333 \
  --no-first-run \
  --no-default-browser-check \
  'https://docs.google.com/spreadsheets/d/10tsMLZTUNoaB_dYYfhDfLMhLYQkoPjG_yAoVJ_soXBA/edit?gid=485920976#gid=485920976'
```

After signing in and confirming the Sheet grid is visible, dry-run:

```bash
node scripts/import_fgconcept_products_from_sheet.js
```

Run the production import:

```bash
node scripts/import_fgconcept_products_from_sheet.js --commit
```

Safety rules:

- The script writes only `fgconcept_products`, `fgconcept_product_snapshots`, and `fgconcept_product_scrape_runs`.
- Dry-run is the default. `--commit` requires `SUPABASE_URL` and a real Supabase `service_role` key from `backend/.env` or the environment.
- If a service-role key is unavailable, `--rpc-token` may be used only with a temporary, token-protected import RPC created for a controlled maintenance import.
- Full successful imports mark missing previously active FGCONCEPT rows inactive instead of deleting them. `--limit-rows` is treated as a partial import and does not mark rows inactive.
- `categories`, `subcategories`, and `first_seen_at` are preserved during upserts.

## OrenSport Agent Price Import

The OrenSport importer reads the local PDF at `/Users/darrenchoong/Downloads/ORENSPORT_AGENT_SG.pdf`, splits slash-separated item-code cells, and preserves all regular/promotion/WSL/new variants. It requires PyMuPDF (`fitz`) in the Python environment.

Dry-run:

```bash
python3 scripts/import_orensport_agent_prices.py
```

Run the production import:

```bash
python3 scripts/import_orensport_agent_prices.py --commit
```

Safety rules:

- The script writes only `orensport_products`.
- `category` and `subcategory` are reserved for later manual enrichment and are preserved during upserts.
- Use a real Supabase `service_role` key for normal imports. Do not loosen RLS or policies on existing shared tables.

## ThumbTech Product PDF Import

The ThumbTech importer reads the local PDFs at `/Users/darrenchoong/Downloads/Drinkware 11.05.2026.pdf` and `/Users/darrenchoong/Downloads/Gadget 11.05.2026.pdf`. It requires PyMuPDF (`fitz`) in the Python environment.

Dry-run:

```bash
python3 scripts/import_thumbtech_products_from_pdf.py
```

Run the production import:

```bash
python3 scripts/import_thumbtech_products_from_pdf.py --commit
```

Safety rules:

- The script writes only `thumbtech_products`, `thumbtech_product_snapshots`, `thumbtech_product_scrape_runs`, and the `thumbtech-product-images` storage bucket.
- Product bands marked `CLEARANCE` are skipped entirely and counted in `excluded_clearance_count`.
- `COMING SOON` values are stored in `incoming_stock` and are not treated as current availability.
- Current warehouse stock is the PDF `STOCK LEVEL`; available stock is `max(stock_level_quantity - reserved_quantity, 0)`.
- Full successful imports mark missing previously active ThumbTech rows inactive instead of deleting them.
- `categories`, `subcategories`, and `first_seen_at` are preserved during upserts.
- `--assume-image-bucket` may be used during controlled imports when the `thumbtech-product-images` bucket has already been created out of band.

## Ultifresh Product PDF Import

The Ultifresh importer reads the local PDF at `/Users/darrenchoong/Downloads/Ultifresh SG -- Normal Agent Price list - 2025.pdf`. It requires PyMuPDF (`fitz`) in the Python environment.

Dry-run:

```bash
python3 scripts/import_ultifresh_products_from_pdf.py
```

Run the production import:

```bash
python3 scripts/import_ultifresh_products_from_pdf.py --commit
```

Safety rules:

- The script writes only `ultifresh_products`, `ultifresh_product_snapshots`, and `ultifresh_product_import_runs`.
- The PDF has no actual stock quantities; all rows use `stock_status = 'assumed_in_stock'` and `stock_quantity = null`.
- `item_unit_price` is the normal agent price; `ma_promo_price` is stored separately when present.
- Full successful imports mark missing previously active Ultifresh rows inactive instead of deleting them.
- `categories`, `subcategories`, and `first_seen_at` are preserved during upserts.
- Do not loosen RLS or policies on existing shared tables. If the local key is anon-only, use scoped temporary Ultifresh import policies and remove them immediately after the import.

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
