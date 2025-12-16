const { supabase } = require('./supabase');

/**
 * Validate fuzzy match to prevent returning wrong products
 * Requires at least 50% word overlap between search term and product name
 *
 * @param {string} searchTerm - Original search term
 * @param {string} foundProductName - Product name found in database
 * @returns {boolean} Whether the match is valid
 */
function validateMatch(searchTerm, foundProductName) {
  const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const productWords = foundProductName.toLowerCase().split(/\s+/);

  // If no significant search words, accept the match
  if (searchWords.length === 0) {
    return true;
  }

  // Calculate word overlap
  const matchingWords = searchWords.filter(sw =>
    productWords.some(pw => pw.includes(sw) || sw.includes(pw))
  );

  // Require at least 50% of search words to match
  const overlapRatio = matchingWords.length / searchWords.length;

  if (overlapRatio < 0.5) {
    console.warn(`[SEARCH] Rejecting low-confidence match: "${searchTerm}" → "${foundProductName}" (${(overlapRatio * 100).toFixed(0)}% overlap)`);
    return false;
  }

  return true;
}

/**
 * Tier 1: Exact match (case-sensitive)
 */
async function searchExact(query, category, limit) {
  let queryBuilder = supabase
    .from('products')
    .select('id, name, category, dimensions, material, color')
    .eq('name', query)
    .limit(limit);

  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data || [];
}

/**
 * Tier 2: Case-insensitive exact match (no wildcards)
 */
async function searchExactInsensitive(query, category, limit) {
  let queryBuilder = supabase
    .from('products')
    .select('id, name, category, dimensions, material, color')
    .ilike('name', query)
    .limit(limit);

  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data || [];
}

/**
 * Tier 3: Fuzzy match (contains search requiring ALL words)
 */
async function searchFuzzy(query, category, limit) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  if (words.length === 0) {
    // Fall back to contains match if no significant words
    let queryBuilder = supabase
      .from('products')
      .select('id, name, category, dimensions, material, color')
      .ilike('name', `%${query.trim()}%`)
      .limit(limit);

    if (category) {
      queryBuilder = queryBuilder.eq('category', category);
    }

    const { data, error } = await queryBuilder;
    if (error) throw new Error(`Database error: ${error.message}`);
    return data || [];
  }

  // Build a query that matches ALL words (not ANY)
  let queryBuilder = supabase
    .from('products')
    .select('id, name, category, dimensions, material, color')
    .limit(limit);

  for (const word of words) {
    queryBuilder = queryBuilder.ilike('name', `%${word}%`);
  }

  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data || [];
}

/**
 * Search for products matching a query string
 * Uses tiered search strategy: Exact → Case-insensitive → Fuzzy with validation
 * Returns matchType with each result to indicate confidence level
 *
 * @param {string} query - Search query (ideally canonical product name from Orchestrator)
 * @param {object} options - Search options
 * @param {number} options.limit - Max results (default 10)
 * @param {string} options.category - Filter by category
 * @returns {Promise<Array>} Matching products with matchType field
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

  console.log(`[SEARCH] Searching for: "${searchTerm}"`);

  // Tier 1: Exact match (case-sensitive)
  let result = await searchExact(searchTerm, category, limit);
  if (result.length > 0) {
    console.log(`[SEARCH] Found ${result.length} exact match(es)`);
    return result.map(r => ({ ...r, matchType: 'exact' }));
  }

  // Tier 2: Case-insensitive exact match (no wildcards)
  result = await searchExactInsensitive(searchTerm, category, limit);
  if (result.length > 0) {
    console.log(`[SEARCH] Found ${result.length} case-insensitive exact match(es)`);
    return result.map(r => ({ ...r, matchType: 'exact_insensitive' }));
  }

  // Tier 3: Fuzzy match with validation
  result = await searchFuzzy(searchTerm, category, limit);
  const validated = result.filter(r => validateMatch(searchTerm, r.name));

  if (validated.length > 0) {
    console.log(`[SEARCH] Found ${validated.length} validated fuzzy match(es) (rejected ${result.length - validated.length})`);
    return validated.map(r => ({ ...r, matchType: 'fuzzy' }));
  }

  // No matches found
  console.log(`[SEARCH] No matches found for "${searchTerm}"`);
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
  getProductSuggestions,
  validateMatch
};
