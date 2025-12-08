# Data Import Instructions

## Overview

This document explains how to parse EasyPrint's pricing CSV file and import it into the Supabase database.

**Source File:** `pricing.csv` (exported from Google Sheets)
**Target Tables:** `products`, `pricing`

---

## CSV Format Structure

The CSV has a **semi-structured hierarchical format**, not a standard tabular format.

### Row Types

| Row Type | Column A | Column B | Column C | Example |
|----------|----------|----------|----------|---------|
| Section Header | Category + Lead Time | "updated on" or empty | Date or empty | `A4 Canvas Tote Bag (Cream) - 5 to 10 working days` |
| Date Row | "updated on" | Date | empty | `updated on, 07.09.2024` |
| Product Row | Full product description | Quantity | Price | `"A4 Canvas Cream Tote Bag (33cmH x 30cmL, No Print)", 30, 2.75` |
| Continuation Row | Empty | Quantity | Price | `, 40, 2.39` |
| Blank Row | Empty | Empty | Empty | `,,` |

---

## Section Header Parsing

Section headers contain the product category and lead time information.

### Format
```
{Product Category} - {Lead Time Description}
```

### Examples
| Section Header | Category | Lead Time Type | Days Min | Days Max |
|----------------|----------|----------------|----------|----------|
| `A4 Canvas Tote Bag (Cream) - 5 to 10 working days` | Tote Bags | local | 5 | 10 |
| `A3 Canvas Tote Bag (Cream) - 5 to 10 working days (A4 logo size)` | Tote Bags | local | 5 | 10 |
| `A3 Canvas Tote Bag (Cream) - 5 to 10 working days (A3 logo size)` | Tote Bags | local | 5 | 10 |

### Lead Time Extraction Rules
| Pattern in Header | lead_time_type | days_min | days_max |
|-------------------|----------------|----------|----------|
| "5 to 10 working days" | `local` | 5 | 10 |
| "10 to 15 working days" | `overseas_air` | 10 | 15 |
| "20 to 35 working days" | `overseas_sea` | 20 | 35 |

### Detection Logic
```javascript
function isSectionHeader(row) {
  // Section header has text in column A that contains " - " and "working days"
  // The next row typically contains "updated on"
  const colA = row[0]?.trim() || '';
  return colA.includes(' - ') && colA.toLowerCase().includes('working days');
}

function parseLeadTime(headerText) {
  const patterns = [
    { regex: /5\s*to\s*10\s*working\s*days/i, type: 'local', min: 5, max: 10 },
    { regex: /10\s*to\s*15\s*working\s*days/i, type: 'overseas_air', min: 10, max: 15 },
    { regex: /20\s*to\s*35\s*working\s*days/i, type: 'overseas_sea', min: 20, max: 35 }
  ];
  
  for (const pattern of patterns) {
    if (pattern.regex.test(headerText)) {
      return { type: pattern.type, min: pattern.min, max: pattern.max };
    }
  }
  
  // Default to local if not found
  return { type: 'local', min: 5, max: 10 };
}
```

---

## Product Row Parsing

Product rows contain the full product description with embedded specifications.

### Format
```
"{Product Name} ({Dimensions}, {Print Option})", {Quantity}, {Price}
```

### Examples

| Column A Value | Extracted Fields |
|----------------|------------------|
| `A4 Canvas Cream Tote Bag (33cmH x 30cmL, No Print)` | name: "A4 Canvas Cream Tote Bag", dimensions: "33cmH x 30cmL", print_option: "No Print" |
| `A4 Canvas Cream Tote Bag (33cmH x 30cmL, silkscreen print - 1c x 0c)` | name: "A4 Canvas Cream Tote Bag", dimensions: "33cmH x 30cmL", print_option: "silkscreen print - 1c x 0c" |
| `A4 Canvas Cream Tote Bag (33cmH x 30cmL, full colour heat transfer print 8cm x 8cm)` | name: "A4 Canvas Cream Tote Bag", dimensions: "33cmH x 30cmL", print_option: "full colour heat transfer print 8cm x 8cm" |

### Parsing Logic
```javascript
function parseProductRow(colA) {
  // Remove leading/trailing quotes if present
  let text = colA.replace(/^"|"$/g, '').trim();
  
  // Find the opening parenthesis for dimensions
  const firstParenIndex = text.indexOf('(');
  if (firstParenIndex === -1) return null;
  
  // Product name is everything before the first (
  const productName = text.substring(0, firstParenIndex).trim();
  
  // Everything inside parentheses
  const insideParens = text.substring(firstParenIndex + 1, text.lastIndexOf(')'));
  
  // Split by comma - first part is dimensions, rest is print option
  const parts = insideParens.split(',').map(p => p.trim());
  
  // Dimensions: typically first part (e.g., "33cmH x 30cmL")
  const dimensions = parts[0];
  
  // Print option: everything after the first comma
  const printOption = parts.slice(1).join(', ').trim();
  
  return {
    product_name: productName,
    dimensions: dimensions,
    print_option: printOption || 'No Print'
  };
}
```

### Multi-line Product Descriptions
Some product descriptions span multiple lines in the CSV:

```csv
"A3 Canvas Cream Tote Bag (42cmH x 38cmL x 8cmD, silkscreen print - 1c x 0c 
within A4 logo size)",30,4.77
```

**Handling:** When parsing, join lines until you find a closing parenthesis followed by a comma and quantity.

---

## Print Option Normalization

Standardize print options for consistent querying.

| Raw Value | Normalized Value |
|-----------|------------------|
| `No Print` | `No Print` |
| `silkscreen print - 1c x 0c` | `silkscreen print - 1c x 0c` |
| `silkscreen print - 2c x 0c` | `silkscreen print - 2c x 0c` |
| `silkscreen print - 2c x 1c` | `silkscreen print - 2c x 1c` |
| `silkscreen print - 2c x 2c` | `silkscreen print - 2c x 2c` |
| `full colour heat transfer print 8cm x 8cm` | `heat transfer 8x8cm` |
| `A5 logo size heat transfer on 1 side` | `heat transfer A5 1-side` |
| `A4 logo size heat transfer on 1 side` | `heat transfer A4 1-side` |
| `1c silkscreen print front, full colour heat transfer print 8cm x 8cm back` | `silkscreen 1c front + heat transfer 8x8cm back` |
| `full colour heat transfer print A5 logo size front,full colour heat transfer print A5 logo size back` | `heat transfer A5 both-sides` |
| `embroidery logo print within 6cm x 10cm` | `embroidery 6x10cm` |

**Note:** You can either normalize OR keep the original values. For v1, recommend keeping original values to match customer requests more easily.

---

## Continuation Row Handling

Continuation rows have empty Column A but contain quantity/price data.

```csv
"A4 Canvas Cream Tote Bag (33cmH x 30cmL, No Print)",30,2.75   ← Product row
,40,2.39                                                        ← Continuation
,50,2.18                                                        ← Continuation
,60,2.03                                                        ← Continuation
```

### Logic
```javascript
function isContinuationRow(row) {
  const colA = row[0]?.trim() || '';
  const colB = row[1];
  const colC = row[2];
  
  return colA === '' && 
         !isNaN(parseFloat(colB)) && 
         !isNaN(parseFloat(colC));
}
```

---

## Blank Row Handling

Blank rows (all columns empty) separate:
- Different print option variants of the same product
- Different products entirely (usually 2+ blank rows)

```csv
,2000,1.69
,,                    ← Blank row (end of variant)
"A4 Canvas Cream Tote Bag (33cmH x 30cmL, silkscreen print - 2c x 0c)",30,6.26
```

---

## Complete Parsing Algorithm

```javascript
async function parseCSV(csvContent) {
  const rows = parseCSVRows(csvContent);
  const records = [];
  
  let currentLeadTime = { type: 'local', min: 5, max: 10 };
  let currentProduct = null;
  let currentPrintOption = null;
  let currentDimensions = null;
  let tierOrder = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const colA = (row[0] || '').trim();
    const colB = row[1];
    const colC = row[2];
    
    // Skip completely blank rows
    if (!colA && !colB && !colC) {
      tierOrder = 0; // Reset for next variant
      continue;
    }
    
    // Check for section header (contains lead time)
    if (isSectionHeader(row)) {
      currentLeadTime = parseLeadTime(colA);
      continue;
    }
    
    // Check for "updated on" row - skip
    if (colA.toLowerCase().includes('updated on')) {
      continue;
    }
    
    // Check for product row (has description in colA)
    if (colA && colA.includes('(') && !isNaN(parseFloat(colB))) {
      const parsed = parseProductRow(colA);
      if (parsed) {
        currentProduct = parsed.product_name;
        currentDimensions = parsed.dimensions;
        currentPrintOption = parsed.print_option;
        tierOrder = 0;
        
        // Add this price tier
        records.push({
          product_name: currentProduct,
          dimensions: currentDimensions,
          print_option: currentPrintOption,
          lead_time_type: currentLeadTime.type,
          lead_time_days_min: currentLeadTime.min,
          lead_time_days_max: currentLeadTime.max,
          quantity: parseInt(colB),
          unit_price: parseFloat(colC),
          is_moq: tierOrder === 0
        });
        tierOrder++;
      }
      continue;
    }
    
    // Check for continuation row
    if (!colA && !isNaN(parseFloat(colB)) && !isNaN(parseFloat(colC))) {
      if (currentProduct) {
        records.push({
          product_name: currentProduct,
          dimensions: currentDimensions,
          print_option: currentPrintOption,
          lead_time_type: currentLeadTime.type,
          lead_time_days_min: currentLeadTime.min,
          lead_time_days_max: currentLeadTime.max,
          quantity: parseInt(colB),
          unit_price: parseFloat(colC),
          is_moq: false
        });
        tierOrder++;
      }
      continue;
    }
  }
  
  return records;
}
```

---

## Data Import Steps

### Step 1: Create Tables
Run the SQL from the PRD to create `products` and `pricing` tables.

### Step 2: Parse CSV
Use the parsing algorithm to convert CSV to records array.

### Step 3: Extract Unique Products
```javascript
const uniqueProducts = [...new Set(records.map(r => r.product_name))];

for (const productName of uniqueProducts) {
  const firstRecord = records.find(r => r.product_name === productName);
  
  await supabase.from('products').upsert({
    name: productName,
    dimensions: firstRecord.dimensions,
    category: deriveCategory(productName) // e.g., "Tote Bags"
  }, { onConflict: 'name' });
}
```

### Step 4: Insert Pricing Records
```javascript
// Get product IDs
const { data: products } = await supabase.from('products').select('id, name');
const productIdMap = Object.fromEntries(products.map(p => [p.name, p.id]));

// Insert pricing with product_id
for (const record of records) {
  await supabase.from('pricing').insert({
    product_id: productIdMap[record.product_name],
    product_name: record.product_name,
    print_option: record.print_option,
    lead_time_type: record.lead_time_type,
    lead_time_days_min: record.lead_time_days_min,
    lead_time_days_max: record.lead_time_days_max,
    quantity: record.quantity,
    unit_price: record.unit_price,
    is_moq: record.is_moq
  });
}
```

### Step 5: Verify Import
```sql
-- Check total records
SELECT COUNT(*) FROM pricing;

-- Check products
SELECT name, COUNT(*) as variants 
FROM pricing 
GROUP BY name 
ORDER BY variants DESC;

-- Check MOQ flags
SELECT product_name, print_option, lead_time_type, quantity, unit_price
FROM pricing
WHERE is_moq = TRUE
ORDER BY product_name, print_option;

-- Sample query test
SELECT * FROM pricing 
WHERE product_name ILIKE '%canvas cream tote%' 
  AND print_option ILIKE '%silkscreen%1c%'
ORDER BY quantity;
```

---

## Category Derivation

Derive category from product name:

```javascript
function deriveCategory(productName) {
  const name = productName.toLowerCase();
  
  if (name.includes('tote bag')) return 'Tote Bags';
  if (name.includes('tumbler')) return 'Drinkware';
  if (name.includes('mug')) return 'Drinkware';
  if (name.includes('bottle')) return 'Drinkware';
  if (name.includes('notebook') || name.includes('notepad')) return 'Stationery';
  if (name.includes('pen')) return 'Stationery';
  if (name.includes('lanyard')) return 'Accessories';
  if (name.includes('umbrella')) return 'Accessories';
  if (name.includes('cap') || name.includes('hat')) return 'Apparel';
  if (name.includes('t-shirt') || name.includes('polo')) return 'Apparel';
  
  return 'Corporate Gifts'; // Default
}
```

---

## Handling Edge Cases

### Duplicate Quantity Rows
Some products have duplicate quantity entries (likely typos):
```csv
,150,1.51
,150,1.49    ← Duplicate quantity
```
**Solution:** Keep the last occurrence (overwrite).

### Missing Data
If a product has only one quantity row with no continuation:
```csv
"A3 Canvas Cream Tote Bag (42cmH x 38cmL x 8cmD, embroidery logo print within 6cm x 10cm)",100,6.27
```
**Solution:** Import as-is. MOQ = 100, only one tier available.

### Multi-line Descriptions
Handle newlines within quoted cells:
```csv
"A3 Canvas Cream Tote Bag (42cmH x 38cmL x 8cmD, silkscreen print - 1c x 0c 
within A4 logo size)",30,4.77
```
**Solution:** Use proper CSV parsing that handles quoted multi-line values.

---

## Validation Checklist

After import, verify:

- [ ] All products have at least one pricing record
- [ ] All pricing records have `is_moq = TRUE` for the lowest quantity tier
- [ ] No duplicate (product_name, print_option, lead_time_type, quantity) combinations
- [ ] All unit_price values are positive decimals
- [ ] All quantity values are positive integers
- [ ] Lead time types are only: `local`, `overseas_air`, `overseas_sea`

---

## Sample Output

After parsing the sample CSV, you should have records like:

| product_name | print_option | lead_time_type | quantity | unit_price | is_moq |
|--------------|--------------|----------------|----------|------------|--------|
| A4 Canvas Cream Tote Bag | No Print | local | 30 | 2.75 | TRUE |
| A4 Canvas Cream Tote Bag | No Print | local | 40 | 2.39 | FALSE |
| A4 Canvas Cream Tote Bag | No Print | local | 50 | 2.18 | FALSE |
| A4 Canvas Cream Tote Bag | silkscreen print - 1c x 0c | local | 30 | 4.42 | TRUE |
| A4 Canvas Cream Tote Bag | silkscreen print - 1c x 0c | local | 40 | 3.82 | FALSE |
| A4 Canvas Cream Tote Bag | silkscreen print - 2c x 0c | local | 30 | 6.26 | TRUE |
| A3 Canvas Cream Tote Bag | No Print | local | 30 | 3.06 | TRUE |
| A3 Canvas Cream Tote Bag | silkscreen print - 1c x 0c within A4 logo size | local | 30 | 4.77 | TRUE |
