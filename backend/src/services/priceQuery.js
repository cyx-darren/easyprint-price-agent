const { supabase } = require('./supabase');

/**
 * Get pricing for a specific product variant at a given quantity
 * Returns the tier that matches or is just below the requested quantity
 *
 * @param {object} params - Query parameters
 * @param {string} params.productName - Product name
 * @param {string} params.printOption - Print option
 * @param {string} params.leadTimeType - Lead time type (local, overseas_air, overseas_sea)
 * @param {number} params.quantity - Requested quantity
 * @returns {Promise<object>} Pricing result
 */
async function getPriceForQuantity(params) {
  const { productName, printOption, leadTimeType = 'local', quantity } = params;

  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!productName) {
    throw new Error('Product name is required');
  }

  // Build query to find the tier at or below requested quantity
  let queryBuilder = supabase
    .from('pricing')
    .select('*')
    .eq('product_name', productName);

  if (printOption) {
    queryBuilder = queryBuilder.eq('print_option', printOption);
  }

  if (leadTimeType) {
    queryBuilder = queryBuilder.eq('lead_time_type', leadTimeType);
  }

  if (quantity) {
    // Get the tier at or below the requested quantity
    queryBuilder = queryBuilder.lte('quantity', quantity);
  }

  queryBuilder = queryBuilder.order('quantity', { ascending: false }).limit(1);

  const { data, error } = await queryBuilder;

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  if (!data || data.length === 0) {
    // Try to get MOQ tier if quantity is below minimum
    const { data: moqData, error: moqError } = await supabase
      .from('pricing')
      .select('*')
      .eq('product_name', productName)
      .eq('print_option', printOption || '')
      .eq('lead_time_type', leadTimeType)
      .eq('is_moq', true)
      .limit(1);

    if (moqError || !moqData || moqData.length === 0) {
      return null;
    }

    // Return MOQ with a note that requested quantity is below minimum
    return {
      ...formatPricingRow(moqData[0]),
      requested_quantity: quantity,
      note: `Minimum order quantity is ${moqData[0].quantity}`
    };
  }

  const tier = data[0];
  return {
    ...formatPricingRow(tier),
    requested_quantity: quantity,
    total_price: quantity ? parseFloat((tier.unit_price * quantity).toFixed(2)) : null
  };
}

/**
 * Get all pricing tiers for a product variant
 *
 * @param {object} params - Query parameters
 * @param {string} params.productName - Product name
 * @param {string} params.printOption - Print option
 * @param {string} params.leadTimeType - Lead time type
 * @returns {Promise<object>} All pricing tiers with lead time info
 */
async function getAllPricingTiers(params) {
  const { productName, printOption, leadTimeType = 'local' } = params;

  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!productName) {
    throw new Error('Product name is required');
  }

  let queryBuilder = supabase
    .from('pricing')
    .select('*')
    .eq('product_name', productName)
    .order('quantity', { ascending: true });

  if (printOption) {
    queryBuilder = queryBuilder.eq('print_option', printOption);
  }

  if (leadTimeType) {
    queryBuilder = queryBuilder.eq('lead_time_type', leadTimeType);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Get lead time info from first row
  const firstRow = data[0];

  return {
    product_name: productName,
    print_option: printOption || firstRow.print_option,
    lead_time: {
      type: firstRow.lead_time_type,
      days_min: firstRow.lead_time_days_min,
      days_max: firstRow.lead_time_days_max
    },
    tiers: data.map(row => ({
      quantity: row.quantity,
      unit_price: parseFloat(row.unit_price),
      is_moq: row.is_moq
    }))
  };
}

/**
 * Get MOQ information for a product across all variants
 *
 * @param {string} productName - Product name
 * @returns {Promise<object>} MOQ information
 */
async function getMOQInfo(productName) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!productName) {
    throw new Error('Product name is required');
  }

  // Get all MOQ rows for this product
  const { data, error } = await supabase
    .from('pricing')
    .select('*')
    .eq('product_name', productName)
    .eq('is_moq', true)
    .order('unit_price', { ascending: true });

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  if (!data || data.length === 0) {
    // Fallback: get the lowest quantity tier for each variant
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('pricing')
      .select('*')
      .eq('product_name', productName)
      .order('quantity', { ascending: true });

    if (fallbackError || !fallbackData || fallbackData.length === 0) {
      return null;
    }

    // Group by print_option + lead_time_type and get lowest quantity for each
    const variantMap = new Map();
    for (const row of fallbackData) {
      const key = `${row.print_option}|${row.lead_time_type}`;
      if (!variantMap.has(key)) {
        variantMap.set(key, row);
      }
    }

    const variants = Array.from(variantMap.values()).map(row => ({
      print_option: row.print_option,
      lead_time_type: row.lead_time_type,
      moq: row.quantity,
      moq_price: parseFloat(row.unit_price)
    }));

    const lowestMoq = variants.reduce((min, v) =>
      v.moq_price < min.moq_price ? v : min
    );

    return {
      product_name: productName,
      variants,
      lowest_moq: {
        quantity: lowestMoq.moq,
        print_option: lowestMoq.print_option,
        unit_price: lowestMoq.moq_price
      }
    };
  }

  // Build variants from MOQ data
  const variants = data.map(row => ({
    print_option: row.print_option,
    lead_time_type: row.lead_time_type,
    moq: row.quantity,
    moq_price: parseFloat(row.unit_price)
  }));

  // Find the lowest MOQ option by price
  const lowestMoq = variants.reduce((min, v) =>
    v.moq_price < min.moq_price ? v : min
  );

  return {
    product_name: productName,
    variants,
    lowest_moq: {
      quantity: lowestMoq.moq,
      print_option: lowestMoq.print_option,
      unit_price: lowestMoq.moq_price
    }
  };
}

/**
 * Get pricing for natural language query results
 * Takes parsed query and found products, returns enriched pricing data
 *
 * @param {object} params - Query parameters
 * @param {Array} params.products - Found products
 * @param {number} params.quantity - Requested quantity
 * @param {string} params.printOption - Print option preference
 * @param {string} params.leadTimeType - Lead time preference
 * @returns {Promise<Array>} Enriched product results with pricing
 */
async function getPricingForProducts(params) {
  const { products, quantity, printOption, leadTimeType = 'local' } = params;

  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!products || products.length === 0) {
    return [];
  }

  // If user specified a print option, first try to find products that have it
  let productsToProcess = products;

  if (printOption) {
    // Check for exact color notation (e.g., "1c x 0c")
    const colorPattern = /(\d)c\s*x\s*(\d)c/i;
    const colorMatch = printOption.toLowerCase().match(colorPattern);
    let searchPattern = printOption;

    if (colorMatch) {
      searchPattern = `${colorMatch[1]}c x ${colorMatch[2]}c`;
    }

    // Find products that have the requested print option
    const productNames = products.map(p => p.name);
    const { data: matchingPricing } = await supabase
      .from('pricing')
      .select('product_name')
      .in('product_name', productNames)
      .eq('lead_time_type', leadTimeType)
      .ilike('print_option', `%${searchPattern}%`);

    if (matchingPricing && matchingPricing.length > 0) {
      const matchingNames = [...new Set(matchingPricing.map(p => p.product_name))];
      // Prioritize products that have the requested print option
      productsToProcess = products.filter(p => matchingNames.includes(p.name));
    }

    // If no products from original list have the option, search more broadly
    if (productsToProcess.length === 0 || (matchingPricing && matchingPricing.length === 0) || !matchingPricing) {
      // Search for any product with similar name that has this print option
      const searchTerms = products[0].name.split(' ').filter(w => w.length > 2);
      const { data: broaderSearch } = await supabase
        .from('pricing')
        .select('product_name')
        .eq('lead_time_type', leadTimeType)
        .ilike('print_option', `%${searchPattern}%`);

      if (broaderSearch && broaderSearch.length > 0) {
        // Find products matching search terms
        const broaderNames = [...new Set(broaderSearch.map(p => p.product_name))];
        const relevantProducts = broaderNames.filter(name =>
          searchTerms.some(term => name.toLowerCase().includes(term.toLowerCase()))
        );

        if (relevantProducts.length > 0) {
          productsToProcess = relevantProducts.map(name => ({
            name,
            dimensions: null,
            category: null
          }));
        }
      }
    }
  }

  const results = await Promise.all(
    productsToProcess.map(async (product) => {
      // Find matching print option or get default
      let selectedPrintOption = printOption;

      if (!selectedPrintOption) {
        // Get first available print option
        const { data: options } = await supabase
          .from('pricing')
          .select('print_option')
          .eq('product_name', product.name)
          .eq('lead_time_type', leadTimeType)
          .limit(1);

        selectedPrintOption = options && options.length > 0 ? options[0].print_option : null;
      } else {
        // Try to match print option with fuzzy matching
        selectedPrintOption = await matchPrintOption(product.name, printOption, leadTimeType);

        // If matched option is different from what user wanted and doesn't contain the key pattern, skip
        if (selectedPrintOption) {
          const colorPattern = /(\d)c\s*x\s*(\d)c/i;
          const userColorMatch = printOption.toLowerCase().match(colorPattern);
          if (userColorMatch) {
            const wantedPattern = `${userColorMatch[1]}c x ${userColorMatch[2]}c`;
            if (!selectedPrintOption.toLowerCase().includes(wantedPattern.toLowerCase())) {
              // This product doesn't have the requested print option
              return null;
            }
          }
        }
      }

      if (!selectedPrintOption) {
        return null;
      }

      // Get pricing for this variant
      const pricing = await getPriceForQuantity({
        productName: product.name,
        printOption: selectedPrintOption,
        leadTimeType,
        quantity
      });

      if (!pricing) {
        return null;
      }

      // Get all tiers for context
      const allTiers = await getAllPricingTiers({
        productName: product.name,
        printOption: selectedPrintOption,
        leadTimeType
      });

      // Get MOQ info for this specific print option
      const { data: moqData } = await supabase
        .from('pricing')
        .select('quantity, unit_price')
        .eq('product_name', product.name)
        .eq('print_option', selectedPrintOption)
        .eq('lead_time_type', leadTimeType)
        .order('quantity', { ascending: true })
        .limit(1);

      const moq = moqData && moqData.length > 0 ? {
        quantity: moqData[0].quantity,
        print_option: selectedPrintOption,
        unit_price: parseFloat(moqData[0].unit_price)
      } : null;

      // Get product dimensions if not available
      let dimensions = product.dimensions;
      if (!dimensions) {
        const { data: productData } = await supabase
          .from('products')
          .select('dimensions, category')
          .eq('name', product.name)
          .single();
        if (productData) {
          dimensions = productData.dimensions;
        }
      }

      return {
        product_name: product.name,
        dimensions: dimensions,
        category: product.category,
        print_option: selectedPrintOption,
        lead_time: allTiers ? allTiers.lead_time : null,
        pricing: {
          requested_quantity: quantity,
          unit_price: pricing.unit_price,
          total_price: pricing.total_price,
          currency: pricing.currency
        },
        moq: moq,
        all_tiers: allTiers ? allTiers.tiers : []
      };
    })
  );

  return results.filter(r => r !== null);
}

/**
 * Match user print option input to actual print option in database
 *
 * @param {string} productName - Product name
 * @param {string} userInput - User's print option input
 * @param {string} leadTimeType - Lead time type
 * @returns {Promise<string|null>} Matched print option or null
 */
async function matchPrintOption(productName, userInput, leadTimeType = 'local') {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  // Get all print options for this product
  const { data, error } = await supabase
    .from('pricing')
    .select('print_option')
    .eq('product_name', productName)
    .eq('lead_time_type', leadTimeType);

  if (error || !data || data.length === 0) {
    return null;
  }

  const availableOptions = [...new Set(data.map(row => row.print_option))];
  const normalizedInput = userInput.toLowerCase().trim();

  // Check for exact color notation patterns first (e.g., "1c x 0c", "2c x 1c")
  const colorPattern = /(\d)c\s*x\s*(\d)c/i;
  const colorMatch = normalizedInput.match(colorPattern);

  if (colorMatch) {
    const frontColors = colorMatch[1];
    const backColors = colorMatch[2];
    const exactPattern = `${frontColors}c x ${backColors}c`;

    // Find exact color match
    const exactColorMatch = availableOptions.find(opt =>
      opt.toLowerCase().includes(exactPattern.toLowerCase())
    );

    if (exactColorMatch) {
      return exactColorMatch;
    }
  }

  // Mapping rules for common user inputs (more specific first)
  const mappings = [
    { patterns: ['no print', 'plain', 'blank', 'without print'], match: 'no print' },
    { patterns: ['1 color', 'one color', 'single color', '1 colour'], match: '1c x 0c' },
    { patterns: ['2 color', 'two color', '2 colour'], match: '2c x 0c' },
    { patterns: ['full color', 'full colour', 'multicolor'], match: 'heat transfer' },
    { patterns: ['heat transfer'], match: 'heat transfer' },
    { patterns: ['silkscreen', 'silk screen', 'screen print'], match: 'silkscreen' },
    { patterns: ['embroidery', 'embroid'], match: 'embroidery' },
    { patterns: ['laser', 'engrave', 'engraving'], match: 'laser' },
    { patterns: ['uv print', 'uv'], match: 'uv' },
    { patterns: ['deboss', 'debossing'], match: 'deboss' }
  ];

  // Try mapping rules
  for (const mapping of mappings) {
    if (mapping.patterns.some(p => normalizedInput.includes(p))) {
      // Find an option that matches
      const matched = availableOptions.find(opt =>
        opt.toLowerCase().includes(mapping.match.toLowerCase())
      );
      if (matched) {
        return matched;
      }
    }
  }

  // Direct ILIKE matching
  const matched = availableOptions.find(opt =>
    opt.toLowerCase().includes(normalizedInput) ||
    normalizedInput.includes(opt.toLowerCase())
  );

  if (matched) {
    return matched;
  }

  // Return first option as fallback if no match
  return availableOptions[0];
}

/**
 * Get alternative products with pricing at a specific quantity
 *
 * @param {string} productName - Current product name
 * @param {number} quantity - Quantity for price comparison
 * @param {number} limit - Max alternatives
 * @returns {Promise<Array>} Alternative products with pricing
 */
async function getAlternatives(productName, quantity, limit = 3) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  // Get current product's category
  const { data: currentProduct } = await supabase
    .from('products')
    .select('category')
    .eq('name', productName)
    .single();

  if (!currentProduct) {
    return [];
  }

  // Get other products in same category
  const { data: alternatives, error } = await supabase
    .from('products')
    .select('name, dimensions')
    .eq('category', currentProduct.category)
    .neq('name', productName)
    .limit(limit);

  if (error || !alternatives || alternatives.length === 0) {
    return [];
  }

  // Get pricing for each alternative
  const results = await Promise.all(
    alternatives.map(async (alt) => {
      const { data: pricing } = await supabase
        .from('pricing')
        .select('print_option, unit_price')
        .eq('product_name', alt.name)
        .eq('lead_time_type', 'local')
        .lte('quantity', quantity || 100)
        .order('quantity', { ascending: false })
        .limit(1);

      if (!pricing || pricing.length === 0) {
        return null;
      }

      return {
        product_name: alt.name,
        print_option: pricing[0].print_option,
        unit_price_at_qty: parseFloat(pricing[0].unit_price)
      };
    })
  );

  return results.filter(r => r !== null);
}

/**
 * Format a pricing database row to standard output format
 */
function formatPricingRow(row) {
  return {
    product_name: row.product_name,
    print_option: row.print_option,
    lead_time_type: row.lead_time_type,
    lead_time_days_min: row.lead_time_days_min,
    lead_time_days_max: row.lead_time_days_max,
    quantity: row.quantity,
    unit_price: parseFloat(row.unit_price),
    currency: row.currency,
    is_moq: row.is_moq
  };
}

module.exports = {
  getPriceForQuantity,
  getAllPricingTiers,
  getMOQInfo,
  getPricingForProducts,
  matchPrintOption,
  getAlternatives
};
