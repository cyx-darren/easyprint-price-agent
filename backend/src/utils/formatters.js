/**
 * Format a successful pricing query response
 *
 * @param {object} data - Pricing data
 * @param {object} meta - Metadata (parsed query, processing time)
 * @returns {object} Formatted response
 */
function formatQueryResponse(data, meta) {
  return {
    success: true,
    data: {
      products_found: data.results?.length || 0,
      results: data.results || [],
      alternatives: data.alternatives || [],
      suggestions: data.suggestions || []
    },
    meta: {
      query_parsed: meta.queryParsed || null,
      processing_time_ms: meta.processingTime || 0,
      message: meta.message || null
    }
  };
}

/**
 * Format a successful lookup response
 *
 * @param {object} pricing - Pricing data
 * @returns {object} Formatted response
 */
function formatLookupResponse(pricing) {
  return {
    success: true,
    data: {
      product_name: pricing.productName,
      print_option: pricing.printOption,
      lead_time_type: pricing.leadTimeType,
      quantity: pricing.quantity,
      unit_price: pricing.unitPrice,
      total_price: pricing.quantity * pricing.unitPrice,
      currency: pricing.currency || 'SGD',
      moq: pricing.moq || null
    }
  };
}

/**
 * Format pricing tiers response
 *
 * @param {object} product - Product info
 * @param {Array} tiers - Pricing tiers
 * @returns {object} Formatted response
 */
function formatTiersResponse(product, tiers) {
  return {
    success: true,
    data: {
      product_name: product.name,
      print_option: product.printOption,
      lead_time: {
        type: product.leadTimeType,
        days_min: product.leadTimeDaysMin,
        days_max: product.leadTimeDaysMax
      },
      tiers: tiers.map(tier => ({
        quantity: tier.quantity,
        unit_price: tier.unitPrice,
        is_moq: tier.isMoq || false
      }))
    }
  };
}

/**
 * Format error response
 *
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @returns {object} Formatted error response
 */
function formatErrorResponse(code, message) {
  return {
    success: false,
    error: {
      code,
      message
    }
  };
}

module.exports = {
  formatQueryResponse,
  formatLookupResponse,
  formatTiersResponse,
  formatErrorResponse
};
