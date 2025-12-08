const { supabase } = require('./supabase');

/**
 * Search for products matching a query string
 * Uses exact match, ILIKE, full-text search in priority order
 *
 * @param {string} query - Search query
 * @param {object} options - Search options
 * @param {number} options.limit - Max results (default 10)
 * @param {string} options.category - Filter by category
 * @returns {Promise<Array>} Matching products
 */
async function searchProducts(query, options = {}) {
  const { limit = 10, category = null } = options;

  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!query || query.trim() === '') {
    return [];
  }

  const searchTerm = query.trim();

  // Step 1: Try exact match first
  let queryBuilder = supabase
    .from('products')
    .select('id, name, category, dimensions, material, color')
    .ilike('name', searchTerm)
    .limit(limit);

  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  let { data: exactMatches, error: exactError } = await queryBuilder;

  if (exactError) {
    throw new Error(`Database error: ${exactError.message}`);
  }

  if (exactMatches && exactMatches.length > 0) {
    return exactMatches;
  }

  // Step 2: Try contains match using ILIKE
  queryBuilder = supabase
    .from('products')
    .select('id, name, category, dimensions, material, color')
    .ilike('name', `%${searchTerm}%`)
    .limit(limit);

  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  let { data: containsMatches, error: containsError } = await queryBuilder;

  if (containsError) {
    throw new Error(`Database error: ${containsError.message}`);
  }

  if (containsMatches && containsMatches.length > 0) {
    return containsMatches;
  }

  // Step 3: Try word-based matching (split query into words)
  const words = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  if (words.length > 0) {
    // Build a query that matches all words
    queryBuilder = supabase
      .from('products')
      .select('id, name, category, dimensions, material, color')
      .limit(limit);

    // Add ILIKE conditions for each word
    for (const word of words) {
      queryBuilder = queryBuilder.ilike('name', `%${word}%`);
    }

    if (category) {
      queryBuilder = queryBuilder.eq('category', category);
    }

    let { data: wordMatches, error: wordError } = await queryBuilder;

    if (wordError) {
      throw new Error(`Database error: ${wordError.message}`);
    }

    if (wordMatches && wordMatches.length > 0) {
      return wordMatches;
    }

    // Step 4: Relaxed search - match ANY word
    queryBuilder = supabase
      .from('products')
      .select('id, name, category, dimensions, material, color')
      .limit(limit);

    // Build OR conditions for words
    const orConditions = words.map(word => `name.ilike.%${word}%`).join(',');
    queryBuilder = queryBuilder.or(orConditions);

    if (category) {
      queryBuilder = queryBuilder.eq('category', category);
    }

    let { data: anyWordMatches, error: anyWordError } = await queryBuilder;

    if (anyWordError) {
      throw new Error(`Database error: ${anyWordError.message}`);
    }

    if (anyWordMatches && anyWordMatches.length > 0) {
      return anyWordMatches;
    }
  }

  // No matches found
  return [];
}

/**
 * Get product by exact name
 *
 * @param {string} name - Exact product name
 * @returns {Promise<object|null>} Product or null
 */
async function getProductByName(name) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!name) {
    return null;
  }

  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, dimensions, material, color')
    .eq('name', name)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Database error: ${error.message}`);
  }

  return data;
}

/**
 * Get all available print options for a product
 *
 * @param {string} productName - Product name
 * @returns {Promise<Array>} Array of print options
 */
async function getProductPrintOptions(productName) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!productName) {
    return [];
  }

  const { data, error } = await supabase
    .from('pricing')
    .select('print_option')
    .eq('product_name', productName);

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  // Get unique print options
  const uniqueOptions = [...new Set(data.map(row => row.print_option))];
  return uniqueOptions.sort();
}

/**
 * Get all products with pagination
 *
 * @param {object} options - Query options
 * @param {number} options.limit - Max results (default 20)
 * @param {number} options.offset - Offset for pagination (default 0)
 * @param {string} options.category - Filter by category
 * @returns {Promise<object>} Products and total count
 */
async function getAllProducts(options = {}) {
  const { limit = 20, offset = 0, category = null } = options;

  if (!supabase) {
    throw new Error('Database not configured');
  }

  // Build query for products
  let queryBuilder = supabase
    .from('products')
    .select('id, name, category, dimensions, material, color', { count: 'exact' })
    .order('name')
    .range(offset, offset + limit - 1);

  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  const { data: products, error, count } = await queryBuilder;

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  // For each product, get print options and MOQ info
  const enrichedProducts = await Promise.all(
    products.map(async (product) => {
      const printOptions = await getProductPrintOptions(product.name);

      // Get MOQ (minimum quantity with is_moq = true or lowest quantity)
      const { data: moqData } = await supabase
        .from('pricing')
        .select('quantity, unit_price')
        .eq('product_name', product.name)
        .eq('is_moq', true)
        .order('unit_price', { ascending: true })
        .limit(1);

      const moq = moqData && moqData.length > 0 ? moqData[0].quantity : null;
      const startingPrice = moqData && moqData.length > 0 ? parseFloat(moqData[0].unit_price) : null;

      return {
        ...product,
        print_options: printOptions,
        moq,
        starting_price: startingPrice
      };
    })
  );

  return {
    products: enrichedProducts,
    total: count,
    limit,
    offset
  };
}

/**
 * Get product suggestions based on partial match
 *
 * @param {string} query - Search query
 * @param {number} limit - Max suggestions
 * @returns {Promise<Array>} Product name suggestions
 */
async function getProductSuggestions(query, limit = 5) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  if (!query || query.trim().length < 2) {
    return [];
  }

  const { data, error } = await supabase
    .from('products')
    .select('name')
    .ilike('name', `%${query.trim()}%`)
    .limit(limit);

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data.map(row => row.name);
}

module.exports = {
  searchProducts,
  getProductByName,
  getProductPrintOptions,
  getAllProducts,
  getProductSuggestions
};
