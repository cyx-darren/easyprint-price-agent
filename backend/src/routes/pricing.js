const express = require('express');
const router = express.Router();

const { parseQuery } = require('../services/queryParser');
const {
  searchProducts,
  getProductByName,
  getAllProducts,
  getProductSuggestions
} = require('../services/productSearch');
const {
  getPriceForQuantity,
  getAllPricingTiers,
  getMOQInfo,
  getPricingForProducts,
  getAlternatives
} = require('../services/priceQuery');
const {
  formatQueryResponse,
  formatLookupResponse,
  formatTiersResponse,
  formatErrorResponse
} = require('../utils/formatters');

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = process.env.PRICE_AGENT_API_KEY;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(
      formatErrorResponse('UNAUTHORIZED', 'Missing or invalid authorization header')
    );
  }

  const token = authHeader.split(' ')[1];
  if (token !== apiKey) {
    return res.status(401).json(
      formatErrorResponse('UNAUTHORIZED', 'Invalid API key')
    );
  }

  next();
};

// Apply authentication to all routes
router.use(authenticate);

// POST /api/price/query - Natural language pricing query
router.post('/query', async (req, res) => {
  const startTime = Date.now();

  try {
    const { query, context } = req.body;

    // Log incoming request
    console.log('[PRICE-QUERY] ========== NEW REQUEST ==========');
    console.log(`[PRICE-QUERY] Query: "${query}"`);
    console.log(`[PRICE-QUERY] Context: ${JSON.stringify(context || {})}`);

    if (!query) {
      console.log('[PRICE-QUERY] ERROR: Missing query parameter');
      return res.status(400).json(
        formatErrorResponse('MISSING_PARAMETERS', 'Query is required')
      );
    }

    // Step 1: Parse the natural language query
    let parsedQuery;
    try {
      parsedQuery = await parseQuery(query);
      console.log('[PRICE-QUERY] Parsed query:');
      console.log(`[PRICE-QUERY]   - Product: "${parsedQuery.product || 'N/A'}"`);
      console.log(`[PRICE-QUERY]   - Quantity: ${parsedQuery.quantity || 'N/A'}`);
      console.log(`[PRICE-QUERY]   - Print option: "${parsedQuery.print_option || 'N/A'}"`);
      console.log(`[PRICE-QUERY]   - Lead time: "${parsedQuery.lead_time || 'local'}"`);
    } catch (error) {
      console.log(`[PRICE-QUERY] ERROR: Could not parse query - ${error.message}`);
      return res.status(400).json(
        formatErrorResponse('INVALID_QUERY', 'Could not parse product from query')
      );
    }

    // Step 2: Search for matching products
    const products = await searchProducts(parsedQuery.product || '', { limit: 5 });

    if (!products || products.length === 0) {
      // No matches - return suggestions
      const suggestions = await getProductSuggestions(parsedQuery.product || '', 5);

      console.log(`[PRICE-QUERY] No matches found for "${parsedQuery.product}"`);
      console.log(`[PRICE-QUERY] Suggestions offered: ${JSON.stringify(suggestions.map(s => s.name || s))}`);
      console.log(`[PRICE-QUERY] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);

      return res.json(formatQueryResponse(
        {
          results: [],
          suggestions
        },
        {
          queryParsed: parsedQuery,
          processingTime: Date.now() - startTime,
          message: suggestions.length > 0
            ? 'No exact matches found. Did you mean one of these products?'
            : 'No matching products found'
        }
      ));
    }

    // Log products found
    console.log(`[PRICE-QUERY] Product search results (${products.length} found):`);
    products.forEach((p, i) => {
      console.log(`[PRICE-QUERY]   ${i + 1}. ${p.name} (ID: ${p.id})`);
    });

    // Step 3: Map lead_time to lead_time_type
    let leadTimeType = 'local';
    if (parsedQuery.lead_time) {
      const lt = parsedQuery.lead_time.toLowerCase();
      if (lt.includes('overseas') || lt.includes('sea')) {
        leadTimeType = lt.includes('air') ? 'overseas_air' : 'overseas_sea';
      }
    }

    // Step 4: Get pricing for found products (with fallback to overseas pricing)
    let results = await getPricingForProducts({
      products,
      quantity: parsedQuery.quantity,
      printOption: parsedQuery.print_option,
      leadTimeType
    });

    // Fallback: If no local pricing found, try overseas_air
    if (results.length === 0 && leadTimeType === 'local') {
      console.log('[PRICE-QUERY] No local pricing found, trying overseas_air...');
      leadTimeType = 'overseas_air';
      results = await getPricingForProducts({
        products,
        quantity: parsedQuery.quantity,
        printOption: parsedQuery.print_option,
        leadTimeType
      });

      // Fallback: If still no results, try overseas_sea
      if (results.length === 0) {
        console.log('[PRICE-QUERY] No overseas_air pricing found, trying overseas_sea...');
        leadTimeType = 'overseas_sea';
        results = await getPricingForProducts({
          products,
          quantity: parsedQuery.quantity,
          printOption: parsedQuery.print_option,
          leadTimeType
        });
      }
    }

    // Log pricing results
    console.log('[PRICE-QUERY] Pricing results:');
    results.forEach((r, i) => {
      console.log(`[PRICE-QUERY]   ${i + 1}. Product: "${r.product_name}"`);
      console.log(`[PRICE-QUERY]      Print: ${r.print_option || 'N/A'} | Lead time: ${r.lead_time?.type || leadTimeType}`);
      console.log(`[PRICE-QUERY]      Quantity: ${r.pricing?.requested_quantity || parsedQuery.quantity || 'N/A'} | Unit price: $${r.pricing?.unit_price} | Total: $${r.pricing?.total_price}`);
      if (r.moq) {
        console.log(`[PRICE-QUERY]      MOQ: ${r.moq.quantity} @ $${r.moq.unit_price}/unit`);
      }
    });

    // Step 5: Get alternatives if we have results
    let alternatives = [];
    if (results.length > 0) {
      alternatives = await getAlternatives(
        results[0].product_name,
        parsedQuery.quantity || 100,
        3
      );

      if (alternatives.length > 0) {
        console.log(`[PRICE-QUERY] Alternatives (${alternatives.length}):`);
        alternatives.forEach((a, i) => {
          console.log(`[PRICE-QUERY]   ${i + 1}. ${a.product_name} - $${a.unit_price_at_qty}/unit`);
        });
      }
    }

    console.log(`[PRICE-QUERY] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);
    console.log(`[PRICE-QUERY] Success: true | Products: ${results.length} | Alternatives: ${alternatives.length}`);

    return res.json(formatQueryResponse(
      {
        results,
        alternatives
      },
      {
        queryParsed: parsedQuery,
        processingTime: Date.now() - startTime
      }
    ));

  } catch (error) {
    console.error('[PRICE-QUERY] ERROR:', error.message);
    console.error('[PRICE-QUERY] Stack:', error.stack);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// POST /api/price/lookup - Direct structured lookup
router.post('/lookup', async (req, res) => {
  const startTime = Date.now();

  try {
    const { product_name, print_option, lead_time_type, quantity } = req.body;

    console.log('[PRICE-LOOKUP] ========== NEW REQUEST ==========');
    console.log(`[PRICE-LOOKUP] Product: "${product_name}"`);
    console.log(`[PRICE-LOOKUP] Print: ${print_option || 'N/A'} | Lead time: ${lead_time_type || 'local'} | Qty: ${quantity || 'N/A'}`);

    if (!product_name) {
      console.log('[PRICE-LOOKUP] ERROR: Missing product_name');
      return res.status(400).json(
        formatErrorResponse('MISSING_PARAMETERS', 'product_name is required')
      );
    }

    // Get pricing for the specified variant
    const pricing = await getPriceForQuantity({
      productName: product_name,
      printOption: print_option,
      leadTimeType: lead_time_type || 'local',
      quantity
    });

    if (!pricing) {
      console.log(`[PRICE-LOOKUP] No pricing found for "${product_name}"`);
      console.log(`[PRICE-LOOKUP] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);
      return res.status(404).json(
        formatErrorResponse('PRODUCT_NOT_FOUND', 'No pricing found for this product variant')
      );
    }

    // Get MOQ info
    const moqInfo = await getMOQInfo(product_name);

    console.log('[PRICE-LOOKUP] Result:');
    console.log(`[PRICE-LOOKUP]   Product: "${pricing.product_name}"`);
    console.log(`[PRICE-LOOKUP]   Quantity: ${pricing.requested_quantity || pricing.quantity} | Unit: $${pricing.unit_price} | Total: $${pricing.total_price}`);
    console.log(`[PRICE-LOOKUP]   MOQ: ${moqInfo ? moqInfo.lowest_moq : 'N/A'}`);
    console.log(`[PRICE-LOOKUP] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);

    return res.json({
      success: true,
      data: {
        product_name: pricing.product_name,
        print_option: pricing.print_option,
        lead_time_type: pricing.lead_time_type,
        quantity: pricing.requested_quantity || pricing.quantity,
        unit_price: pricing.unit_price,
        total_price: pricing.total_price,
        currency: pricing.currency,
        moq: moqInfo ? moqInfo.lowest_moq : null
      }
    });

  } catch (error) {
    console.error('[PRICE-LOOKUP] ERROR:', error.message);
    console.error('[PRICE-LOOKUP] Stack:', error.stack);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// GET /api/price/products - List all products
router.get('/products', async (req, res) => {
  const startTime = Date.now();

  try {
    const { category, limit = 20, offset = 0 } = req.query;

    console.log('[PRICE-PRODUCTS] ========== NEW REQUEST ==========');
    console.log(`[PRICE-PRODUCTS] Category: ${category || 'all'} | Limit: ${limit} | Offset: ${offset}`);

    const result = await getAllProducts({
      category,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });

    console.log(`[PRICE-PRODUCTS] Returned ${result.products ? result.products.length : 0} products`);
    console.log(`[PRICE-PRODUCTS] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[PRICE-PRODUCTS] ERROR:', error.message);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// GET /api/price/product/:name/tiers - Get pricing tiers for a product
router.get('/product/:name/tiers', async (req, res) => {
  const startTime = Date.now();

  try {
    const { name } = req.params;
    const { print_option, lead_time } = req.query;

    console.log('[PRICE-TIERS] ========== NEW REQUEST ==========');
    console.log(`[PRICE-TIERS] Product: "${name}"`);
    console.log(`[PRICE-TIERS] Print: ${print_option || 'N/A'} | Lead time: ${lead_time || 'local'}`);

    if (!name) {
      console.log('[PRICE-TIERS] ERROR: Missing product name');
      return res.status(400).json(
        formatErrorResponse('MISSING_PARAMETERS', 'Product name is required')
      );
    }

    const decodedName = decodeURIComponent(name);

    // Verify product exists
    const product = await getProductByName(decodedName);
    if (!product) {
      console.log(`[PRICE-TIERS] Product not found: "${decodedName}"`);
      console.log(`[PRICE-TIERS] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);
      return res.status(404).json(
        formatErrorResponse('PRODUCT_NOT_FOUND', 'Product not found')
      );
    }

    // Get pricing tiers
    const tiers = await getAllPricingTiers({
      productName: decodedName,
      printOption: print_option,
      leadTimeType: lead_time || 'local'
    });

    if (!tiers) {
      console.log(`[PRICE-TIERS] No tiers found for "${decodedName}"`);
      console.log(`[PRICE-TIERS] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);
      return res.status(404).json(
        formatErrorResponse('PRODUCT_NOT_FOUND', 'No pricing tiers found for this variant')
      );
    }

    console.log(`[PRICE-TIERS] Found ${tiers.tiers ? tiers.tiers.length : 0} pricing tiers`);
    console.log(`[PRICE-TIERS] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);

    return res.json({
      success: true,
      data: tiers
    });

  } catch (error) {
    console.error('[PRICE-TIERS] ERROR:', error.message);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// GET /api/price/moq/:productName - Get MOQ info for a product
router.get('/moq/:productName', async (req, res) => {
  const startTime = Date.now();

  try {
    const { productName } = req.params;

    console.log('[PRICE-MOQ] ========== NEW REQUEST ==========');
    console.log(`[PRICE-MOQ] Product: "${productName}"`);

    if (!productName) {
      console.log('[PRICE-MOQ] ERROR: Missing product name');
      return res.status(400).json(
        formatErrorResponse('MISSING_PARAMETERS', 'Product name is required')
      );
    }

    const decodedName = decodeURIComponent(productName);

    // Get MOQ info
    const moqInfo = await getMOQInfo(decodedName);

    if (!moqInfo) {
      console.log(`[PRICE-MOQ] No MOQ info found for "${decodedName}"`);
      console.log(`[PRICE-MOQ] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);
      return res.status(404).json(
        formatErrorResponse('PRODUCT_NOT_FOUND', 'No MOQ information found for this product')
      );
    }

    console.log(`[PRICE-MOQ] MOQ for "${decodedName}": ${moqInfo.lowest_moq}`);
    console.log(`[PRICE-MOQ] ========== RESPONSE SENT (${Date.now() - startTime}ms) ==========`);

    return res.json({
      success: true,
      data: moqInfo
    });

  } catch (error) {
    console.error('[PRICE-MOQ] ERROR:', error.message);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

module.exports = router;
