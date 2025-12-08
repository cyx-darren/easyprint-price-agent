/**
 * CSV Data Import Script
 * Parses pricing.csv and imports into Supabase
 *
 * Usage: npm run import
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CSV file path - check both locations
const CSV_PATHS = [
  path.join(__dirname, '../data/pricing.csv'),
  path.join(__dirname, '../imported_pricing/pricing.csv')
];

/**
 * Detect if row is a section header (contains lead time info)
 */
function isSectionHeader(row) {
  const colA = (row[0] || '').trim();
  return colA.includes(' - ') && colA.toLowerCase().includes('working days');
}

/**
 * Parse lead time from section header
 */
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

  return { type: 'local', min: 5, max: 10 };
}

/**
 * Parse product row to extract name, dimensions, print option
 */
function parseProductRow(colA) {
  let text = colA.replace(/^"|"$/g, '').trim();

  const firstParenIndex = text.indexOf('(');
  if (firstParenIndex === -1) return null;

  const productName = text.substring(0, firstParenIndex).trim();
  const lastParenIndex = text.lastIndexOf(')');
  const insideParens = text.substring(firstParenIndex + 1, lastParenIndex);

  const parts = insideParens.split(',').map(p => p.trim());
  const dimensions = parts[0];
  const printOption = parts.slice(1).join(', ').trim() || 'No Print';

  return {
    product_name: productName,
    dimensions: dimensions,
    print_option: printOption
  };
}

/**
 * Derive category from product name
 */
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

  return 'Corporate Gifts';
}

/**
 * Parse CSV content into pricing records
 */
function parseCSV(csvContent) {
  const rows = parse(csvContent, {
    skip_empty_lines: false,
    relax_quotes: true,
    relax_column_count: true
  });

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
      tierOrder = 0;
      continue;
    }

    // Check for section header
    if (isSectionHeader(row)) {
      currentLeadTime = parseLeadTime(colA);
      continue;
    }

    // Skip "updated on" rows
    if (colA.toLowerCase().includes('updated on')) {
      continue;
    }

    // Skip header row
    if (colA === '' && colB === 'Qty') {
      continue;
    }

    // Check for product row
    if (colA && colA.includes('(') && !isNaN(parseFloat(colB))) {
      const parsed = parseProductRow(colA);
      if (parsed) {
        currentProduct = parsed.product_name;
        currentDimensions = parsed.dimensions;
        currentPrintOption = parsed.print_option;
        tierOrder = 0;

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

/**
 * Main import function
 */
async function importData() {
  console.log('Starting data import...\n');

  // Find CSV file
  let csvPath = null;
  for (const p of CSV_PATHS) {
    if (fs.existsSync(p)) {
      csvPath = p;
      break;
    }
  }

  if (!csvPath) {
    console.error('Error: pricing.csv not found');
    process.exit(1);
  }

  console.log(`Reading CSV from: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  // Parse CSV
  console.log('Parsing CSV...');
  const records = parseCSV(csvContent);
  console.log(`Parsed ${records.length} pricing records\n`);

  // Extract unique products
  const productMap = new Map();
  for (const record of records) {
    if (!productMap.has(record.product_name)) {
      productMap.set(record.product_name, {
        name: record.product_name,
        dimensions: record.dimensions,
        category: deriveCategory(record.product_name)
      });
    }
  }

  console.log(`Found ${productMap.size} unique products\n`);

  // Insert products
  console.log('Inserting products...');
  const products = Array.from(productMap.values());

  for (const product of products) {
    const { error } = await supabase
      .from('products')
      .upsert(product, { onConflict: 'name' });

    if (error) {
      console.error(`Error inserting product ${product.name}:`, error.message);
    }
  }
  console.log('Products inserted.\n');

  // Get product IDs
  const { data: productData } = await supabase
    .from('products')
    .select('id, name');

  const productIdMap = Object.fromEntries(
    productData.map(p => [p.name, p.id])
  );

  // Insert pricing records in batches
  console.log('Inserting pricing records...');
  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize).map(record => ({
      product_id: productIdMap[record.product_name],
      product_name: record.product_name,
      print_option: record.print_option,
      lead_time_type: record.lead_time_type,
      lead_time_days_min: record.lead_time_days_min,
      lead_time_days_max: record.lead_time_days_max,
      quantity: record.quantity,
      unit_price: record.unit_price,
      is_moq: record.is_moq
    }));

    const { error } = await supabase
      .from('pricing')
      .insert(batch);

    if (error) {
      console.error(`Error inserting batch:`, error.message);
    } else {
      inserted += batch.length;
      process.stdout.write(`\rInserted ${inserted}/${records.length} records`);
    }
  }

  console.log('\n\nImport complete!');
  console.log(`- Products: ${productMap.size}`);
  console.log(`- Pricing records: ${inserted}`);
}

// Run import
importData().catch(console.error);
