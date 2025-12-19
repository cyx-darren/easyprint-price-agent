# CSV Upload Guide - Price Agent

## Overview

This guide explains how to upload pricing data from CSV files into the Supabase database for the Price Agent system.

**Source:** CSV files exported from Google Sheets
**Target:** Supabase PostgreSQL database (`products` and `pricing` tables)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [CSV File Format](#csv-file-format)
3. [Method 1: Using the Import Script (Recommended)](#method-1-using-the-import-script-recommended)
4. [Method 2: Using SQL Import](#method-2-using-sql-import)
5. [Method 3: Manual Supabase Dashboard Upload](#method-3-manual-supabase-dashboard-upload)
6. [Verifying the Import](#verifying-the-import)
7. [Troubleshooting](#troubleshooting)
8. [Updating Existing Prices](#updating-existing-prices)

---

## Prerequisites

### 1. Environment Setup

Ensure you have the following environment variables set in `backend/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

### 2. Database Tables

The following tables must exist in Supabase. Run this SQL if they don't exist:

```sql
-- Products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  dimensions TEXT,
  material TEXT,
  color TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_product_name UNIQUE (name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_products_name_search
  ON products USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Pricing table
CREATE TABLE IF NOT EXISTS pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  print_option TEXT NOT NULL,
  lead_time_type TEXT NOT NULL,
  lead_time_days_min INT,
  lead_time_days_max INT,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'SGD',
  is_moq BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pricing_product_id ON pricing(product_id);
CREATE INDEX IF NOT EXISTS idx_pricing_product_name ON pricing(product_name);
CREATE INDEX IF NOT EXISTS idx_pricing_lookup
  ON pricing(product_name, print_option, lead_time_type, quantity);
CREATE INDEX IF NOT EXISTS idx_pricing_moq ON pricing(product_id, is_moq) WHERE is_moq = TRUE;
```

### 3. Install Dependencies

```bash
cd backend
npm install
```

Required packages (already in `package.json`):
- `csv-parse` - For parsing CSV files
- `@supabase/supabase-js` - Supabase client
- `dotenv` - Environment variables

---

## CSV File Format

### EasyPrint CSV Structure

The CSV has a **semi-structured hierarchical format** with the following row types:

| Row Type | Column A | Column B | Column C | Example |
|----------|----------|----------|----------|---------|
| Header Row | Empty | "Qty" | "Price before GST" | `,Qty,Price before GST` |
| Section Header | Category + Lead Time | "updated on" | Date | `A4 Canvas Tote Bag (Cream) - 5 to 10 working days,updated on,07.09.2024` |
| Product Row | Full product description | Quantity | Price | `"A4 Canvas Cream Tote Bag (33cmH x 30cmL, No Print)",30,2.75` |
| Continuation Row | Empty | Quantity | Price | `,40,2.39` |
| Blank Row | Empty | Empty | Empty | `,,` |

### Sample CSV Content

```csv
,Qty,Price before GST
A4 Canvas Tote Bag (Cream) - 5 to 10 working days,updated on,07.09.2024
"A4 Canvas Cream Tote Bag (33cmH x 30cmL, No Print)",30,2.75
,40,2.39
,50,2.18
,100,1.71
,500,1.35
,1000,1.16
,,
"A4 Canvas Cream Tote Bag (33cmH x 30cmL, silkscreen print - 1c x 0c)",30,4.42
,40,3.82
,50,3.46
,100,2.68
,500,2.01
,1000,1.75
,,
```

### Lead Time Types

| Pattern in Section Header | Lead Time Type | Days |
|---------------------------|----------------|------|
| "5 to 10 working days" | `local` | 5-10 |
| "10 to 15 working days" | `overseas_air` | 10-15 |
| "20 to 35 working days" | `overseas_sea` | 20-35 |

### Product Description Format

```
"{Product Name} ({Dimensions}, {Print Option})"
```

**Examples:**

| Full Description | Extracted Fields |
|-----------------|------------------|
| `A4 Canvas Cream Tote Bag (33cmH x 30cmL, No Print)` | name: "A4 Canvas Cream Tote Bag", dimensions: "33cmH x 30cmL", print_option: "No Print" |
| `A4 Canvas Cream Tote Bag (33cmH x 30cmL, silkscreen print - 1c x 0c)` | name: "A4 Canvas Cream Tote Bag", dimensions: "33cmH x 30cmL", print_option: "silkscreen print - 1c x 0c" |

---

## Method 1: Using the Import Script (Recommended)

This is the easiest and safest method.

### Step 1: Place the CSV File

Place your CSV file in one of these locations:
- `data/pricing.csv` (preferred)
- `imported_pricing/pricing.csv`

```bash
# From project root
cp /path/to/your/pricing.csv data/pricing.csv
```

### Step 2: Run the Import Script

```bash
cd backend
npm run import
```

Or run directly:

```bash
node ../scripts/importData.js
```

### Step 3: Monitor Output

You'll see output like:

```
Starting data import...

Reading CSV from: /path/to/pricing.csv
Parsing CSV...
Parsed 1547 pricing records

Found 112 unique products

Inserting products...
Products inserted.

Inserting pricing records...
Inserted 1547/1547 records

Import complete!
- Products: 112
- Pricing records: 1547
```

### Import Script Features

The script automatically:
- Parses section headers to extract lead time info
- Extracts product name, dimensions, and print option from product rows
- Handles continuation rows (quantity tiers)
- Derives product categories from names
- Sets `is_moq = true` for the first quantity tier of each variant
- Batches inserts (100 records at a time) for performance
- Uses `upsert` for products to avoid duplicates

---

## Method 2: Using SQL Import

If you need more control or want to run imports via Supabase SQL Editor.

### Step 1: Parse CSV to JSON

```bash
node scripts/parseAndGenerateSQL.js > /tmp/parsed_data.json
```

### Step 2: Generate SQL Statements

The `generatePricingSQL.js` script generates INSERT statements in batches:

```bash
# Generate batch 0 (first 200 records)
node scripts/generatePricingSQL.js 0 > batch0.sql

# Generate batch 1 (next 200 records)
node scripts/generatePricingSQL.js 1 > batch1.sql

# Continue for all batches...
```

### Step 3: Run SQL in Supabase

1. Open Supabase Dashboard
2. Go to **SQL Editor**
3. Paste the SQL from each batch file
4. Click **Run**

### Sample Generated SQL

```sql
INSERT INTO pricing (product_id, product_name, print_option, lead_time_type, lead_time_days_min, lead_time_days_max, quantity, unit_price, is_moq) VALUES
('63b5d0d1-74e1-45ec-935d-c37f7f584cc7', 'A4 Canvas Cream Tote Bag', 'No Print', 'local', 5, 10, 30, 2.75, true),
('63b5d0d1-74e1-45ec-935d-c37f7f584cc7', 'A4 Canvas Cream Tote Bag', 'No Print', 'local', 5, 10, 40, 2.39, false),
('63b5d0d1-74e1-45ec-935d-c37f7f584cc7', 'A4 Canvas Cream Tote Bag', 'No Print', 'local', 5, 10, 50, 2.18, false);
```

---

## Method 3: Manual Supabase Dashboard Upload

For small updates or testing.

### Step 1: Prepare Data

Format your data as CSV with these columns:

**For `products` table:**
```csv
name,category,dimensions,material,color
A4 Canvas Cream Tote Bag,Tote Bags,33cmH x 30cmL,Canvas,Cream
A4 Canvas Black Tote Bag,Tote Bags,33cmH x 30cmL,Canvas,Black
```

**For `pricing` table:**
```csv
product_name,print_option,lead_time_type,lead_time_days_min,lead_time_days_max,quantity,unit_price,is_moq
A4 Canvas Cream Tote Bag,No Print,local,5,10,30,2.75,true
A4 Canvas Cream Tote Bag,No Print,local,5,10,40,2.39,false
A4 Canvas Cream Tote Bag,No Print,local,5,10,50,2.18,false
```

### Step 2: Import via Dashboard

1. Open Supabase Dashboard
2. Go to **Table Editor**
3. Select the table (`products` or `pricing`)
4. Click **Insert** → **Import data from CSV**
5. Upload your CSV file
6. Map columns and click **Import**

**Note:** You'll need to set `product_id` after importing products.

---

## Verifying the Import

Run these queries in Supabase SQL Editor to verify the import:

### Check Total Records

```sql
-- Count products
SELECT COUNT(*) as product_count FROM products;

-- Count pricing records
SELECT COUNT(*) as pricing_count FROM pricing;
```

### Check Products by Category

```sql
SELECT category, COUNT(*) as count
FROM products
GROUP BY category
ORDER BY count DESC;
```

### Check Pricing Distribution

```sql
SELECT
  product_name,
  COUNT(*) as pricing_tiers,
  MIN(quantity) as min_qty,
  MAX(quantity) as max_qty
FROM pricing
GROUP BY product_name
ORDER BY pricing_tiers DESC
LIMIT 20;
```

### Verify MOQ Flags

```sql
-- Check MOQ entries
SELECT
  product_name,
  print_option,
  lead_time_type,
  quantity,
  unit_price
FROM pricing
WHERE is_moq = TRUE
ORDER BY product_name, print_option
LIMIT 50;
```

### Check Lead Time Types

```sql
SELECT
  lead_time_type,
  COUNT(*) as count
FROM pricing
GROUP BY lead_time_type;
```

### Sample Query Test

```sql
-- Test a typical price lookup
SELECT * FROM pricing
WHERE product_name ILIKE '%canvas cream tote%'
  AND print_option ILIKE '%silkscreen%1c%'
  AND lead_time_type = 'local'
ORDER BY quantity;
```

---

## Troubleshooting

### Common Issues

#### 1. "Product ID not found"

**Cause:** Products weren't inserted before pricing records.

**Solution:** Run products insert first, then pricing:

```bash
# Clear pricing table
# In Supabase SQL Editor:
TRUNCATE pricing;

# Re-run import
npm run import
```

#### 2. Duplicate Key Error

**Cause:** Product or pricing already exists.

**Solution:** Use upsert or clear tables first:

```sql
-- Clear all data (use with caution!)
TRUNCATE pricing;
TRUNCATE products CASCADE;
```

#### 3. Multi-line Descriptions Not Parsing

**Cause:** Some product descriptions span multiple lines in the CSV.

**Solution:** The import script handles this, but if using manual import:

```javascript
// Join multi-line descriptions
text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
```

#### 4. Wrong Category Assigned

**Cause:** Category derivation is based on keywords.

**Solution:** Update the `deriveCategory()` function in `importData.js`:

```javascript
function deriveCategory(productName) {
  const name = productName.toLowerCase();

  if (name.includes('tote bag')) return 'Tote Bags';
  if (name.includes('tumbler')) return 'Drinkware';
  if (name.includes('mug')) return 'Drinkware';
  // Add more patterns as needed...

  return 'Corporate Gifts'; // Default
}
```

#### 5. Prices Not Appearing in API

**Cause:** `product_id` not linked.

**Solution:** Verify `product_id` is set:

```sql
SELECT COUNT(*) FROM pricing WHERE product_id IS NULL;

-- If there are nulls, update them:
UPDATE pricing p
SET product_id = (SELECT id FROM products WHERE name = p.product_name)
WHERE product_id IS NULL;
```

---

## Updating Existing Prices

### Option 1: Full Refresh (Recommended for Major Updates)

```sql
-- Backup first
CREATE TABLE pricing_backup AS SELECT * FROM pricing;

-- Clear and re-import
TRUNCATE pricing;
```

Then run the import script.

### Option 2: Update Specific Products

```sql
-- Delete pricing for specific product
DELETE FROM pricing WHERE product_name = 'A4 Canvas Cream Tote Bag';

-- Then import just that product's pricing
```

### Option 3: Update Specific Prices

```sql
-- Update a single price point
UPDATE pricing
SET unit_price = 2.50
WHERE product_name = 'A4 Canvas Cream Tote Bag'
  AND print_option = 'No Print'
  AND lead_time_type = 'local'
  AND quantity = 30;
```

### Option 4: Bulk Price Adjustment

```sql
-- Increase all prices by 5%
UPDATE pricing SET unit_price = unit_price * 1.05;

-- Decrease specific category prices
UPDATE pricing p
SET unit_price = unit_price * 0.95
WHERE p.product_name IN (
  SELECT name FROM products WHERE category = 'Tote Bags'
);
```

---

## Appendix: Category Keywords

The import script derives categories from product names:

| Keyword(s) | Category |
|------------|----------|
| `tote bag` | Tote Bags |
| `tumbler` | Drinkware |
| `mug` | Drinkware |
| `bottle` | Drinkware |
| `notebook`, `notepad` | Stationery |
| `pen` | Stationery |
| `lanyard` | Accessories |
| `umbrella` | Accessories |
| `cap`, `hat` | Apparel |
| `t-shirt`, `polo` | Apparel |
| *(default)* | Corporate Gifts |

To add more categories, update `scripts/importData.js`:

```javascript
function deriveCategory(productName) {
  const name = productName.toLowerCase();

  // Add new patterns here
  if (name.includes('backpack')) return 'Bags';
  if (name.includes('cooler')) return 'Bags';

  // ... existing patterns ...

  return 'Corporate Gifts';
}
```

---

## Quick Reference

### File Locations

| File | Purpose |
|------|---------|
| `data/pricing.csv` | Primary CSV location |
| `imported_pricing/pricing.csv` | Alternative CSV location |
| `scripts/importData.js` | Main import script |
| `scripts/parseAndGenerateSQL.js` | CSV to JSON parser |
| `scripts/generatePricingSQL.js` | JSON to SQL generator |

### Commands

```bash
# Run full import
cd backend && npm run import

# Parse CSV to JSON
node scripts/parseAndGenerateSQL.js > /tmp/parsed.json

# Generate SQL batches
node scripts/generatePricingSQL.js 0 > batch0.sql
```

### Supabase SQL Shortcuts

```sql
-- Count all records
SELECT 'products' as table_name, COUNT(*) as count FROM products
UNION ALL
SELECT 'pricing', COUNT(*) FROM pricing;

-- Quick product search
SELECT DISTINCT product_name FROM pricing ORDER BY product_name;

-- Check for orphaned pricing
SELECT COUNT(*) FROM pricing WHERE product_id IS NULL;
```

---

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review the import script logs
3. Verify CSV format matches expected structure
4. Check Supabase logs in Dashboard → Logs → Postgres
