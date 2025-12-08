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

    if (!query) {
      return res.status(400).json(
        formatErrorResponse('MISSING_PARAMETERS', 'Query is required')
      );
    }

    // Step 1: Parse the natural language query
    let parsedQuery;
    try {
      parsedQuery = await parseQuery(query);
    } catch (error) {
      return res.status(400).json(
        formatErrorResponse('INVALID_QUERY', 'Could not parse product from query')
      );
    }

    // Step 2: Search for matching products
    const products = await searchProducts(parsedQuery.product || '', { limit: 5 });

    if (!products || products.length === 0) {
      // No matches - return suggestions
      const suggestions = await getProductSuggestions(parsedQuery.product || '', 5);

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

    // Step 3: Map lead_time to lead_time_type
    let leadTimeType = 'local';
    if (parsedQuery.lead_time) {
      const lt = parsedQuery.lead_time.toLowerCase();
      if (lt.includes('overseas') || lt.includes('sea')) {
        leadTimeType = lt.includes('air') ? 'overseas_air' : 'overseas_sea';
      }
    }

    // Step 4: Get pricing for found products
    const results = await getPricingForProducts({
      products,
      quantity: parsedQuery.quantity,
      printOption: parsedQuery.print_option,
      leadTimeType
    });

    // Step 5: Get alternatives if we have results
    let alternatives = [];
    if (results.length > 0) {
      alternatives = await getAlternatives(
        results[0].product_name,
        parsedQuery.quantity || 100,
        3
      );
    }

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
    console.error('Query error:', error);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// POST /api/price/lookup - Direct structured lookup
router.post('/lookup', async (req, res) => {
  try {
    const { product_name, print_option, lead_time_type, quantity } = req.body;

    if (!product_name) {
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
      return res.status(404).json(
        formatErrorResponse('PRODUCT_NOT_FOUND', 'No pricing found for this product variant')
      );
    }

    // Get MOQ info
    const moqInfo = await getMOQInfo(product_name);

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
    console.error('Lookup error:', error);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// GET /api/price/products - List all products
router.get('/products', async (req, res) => {
  try {
    const { category, limit = 20, offset = 0 } = req.query;

    const result = await getAllProducts({
      category,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Products list error:', error);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// GET /api/price/product/:name/tiers - Get pricing tiers for a product
router.get('/product/:name/tiers', async (req, res) => {
  try {
    const { name } = req.params;
    const { print_option, lead_time } = req.query;

    if (!name) {
      return res.status(400).json(
        formatErrorResponse('MISSING_PARAMETERS', 'Product name is required')
      );
    }

    const decodedName = decodeURIComponent(name);

    // Verify product exists
    const product = await getProductByName(decodedName);
    if (!product) {
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
      return res.status(404).json(
        formatErrorResponse('PRODUCT_NOT_FOUND', 'No pricing tiers found for this variant')
      );
    }

    return res.json({
      success: true,
      data: tiers
    });

  } catch (error) {
    console.error('Tiers error:', error);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

// GET /api/price/moq/:productName - Get MOQ info for a product
router.get('/moq/:productName', async (req, res) => {
  try {
    const { productName } = req.params;

    if (!productName) {
      return res.status(400).json(
        formatErrorResponse('MISSING_PARAMETERS', 'Product name is required')
      );
    }

    const decodedName = decodeURIComponent(productName);

    // Get MOQ info
    const moqInfo = await getMOQInfo(decodedName);

    if (!moqInfo) {
      return res.status(404).json(
        formatErrorResponse('PRODUCT_NOT_FOUND', 'No MOQ information found for this product')
      );
    }

    return res.json({
      success: true,
      data: moqInfo
    });

  } catch (error) {
    console.error('MOQ error:', error);
    return res.status(500).json(
      formatErrorResponse('DATABASE_ERROR', error.message)
    );
  }
});

module.exports = router;
