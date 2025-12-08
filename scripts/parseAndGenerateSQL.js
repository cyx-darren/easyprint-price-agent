/**
 * Parse CSV and output SQL INSERT statements
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const CSV_PATH = path.join(__dirname, '../imported_pricing/pricing.csv');

function isSectionHeader(row) {
  const colA = (row[0] || '').trim();
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

  return { type: 'local', min: 5, max: 10 };
}

function parseProductRow(colA) {
  let text = colA.replace(/^"|"$/g, '').trim();
  // Handle multi-line descriptions by removing newlines
  text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  const firstParenIndex = text.indexOf('(');
  if (firstParenIndex === -1) return null;

  const productName = text.substring(0, firstParenIndex).trim();
  const lastParenIndex = text.lastIndexOf(')');

  if (lastParenIndex === -1) {
    // Handle malformed entries - try to extract what we can
    const insideParens = text.substring(firstParenIndex + 1);
    const parts = insideParens.split(',').map(p => p.trim());
    const dimensions = parts[0];
    const printOption = parts.slice(1).join(', ').trim() || 'No Print';
    return { product_name: productName, dimensions, print_option: printOption };
  }

  const insideParens = text.substring(firstParenIndex + 1, lastParenIndex);
  const parts = insideParens.split(',').map(p => p.trim());
  const dimensions = parts[0];
  const printOption = parts.slice(1).join(', ').trim() || 'No Print';

  return { product_name: productName, dimensions, print_option: printOption };
}

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

function escapeSQL(str) {
  if (!str) return '';
  return str.replace(/'/g, "''");
}

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
  let isFirstTier = true;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let colA = (row[0] || '').trim();
    const colB = row[1];
    const colC = row[2];

    // Handle multi-line descriptions
    if (colA && colA.startsWith('"') && !colA.endsWith('"') && colA.includes('(')) {
      // Multi-line - collect next lines until we find closing
      let j = i + 1;
      while (j < rows.length) {
        const nextRow = rows[j];
        const nextColA = (nextRow[0] || '').trim();
        if (nextColA) {
          colA += ' ' + nextColA;
          if (nextColA.includes(')')) {
            // Check if this row has quantity/price
            if (!isNaN(parseFloat(nextRow[1])) && !isNaN(parseFloat(nextRow[2]))) {
              rows[i][1] = nextRow[1];
              rows[i][2] = nextRow[2];
            }
            break;
          }
        }
        j++;
      }
    }

    // Skip completely blank rows
    if (!colA && !colB && !colC) {
      isFirstTier = true;
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
    if (colB === 'Qty' || colB === 'Price before GST') {
      continue;
    }

    // Check for product row
    if (colA && colA.includes('(') && !isNaN(parseFloat(colB))) {
      const parsed = parseProductRow(colA);
      if (parsed) {
        currentProduct = parsed.product_name;
        currentDimensions = parsed.dimensions;
        currentPrintOption = parsed.print_option;
        isFirstTier = true;

        records.push({
          product_name: currentProduct,
          dimensions: currentDimensions,
          print_option: currentPrintOption,
          lead_time_type: currentLeadTime.type,
          lead_time_days_min: currentLeadTime.min,
          lead_time_days_max: currentLeadTime.max,
          quantity: parseInt(colB),
          unit_price: parseFloat(colC),
          is_moq: isFirstTier
        });
        isFirstTier = false;
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
      }
      continue;
    }
  }

  return records;
}

// Main
const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
const records = parseCSV(csvContent);

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

// Output products as JSON
const products = Array.from(productMap.values());
console.log(JSON.stringify({ products, records }, null, 2));
