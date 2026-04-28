const { supabase } = require('./supabase');

const SAMPLE_QUERY_PATTERN = /\b(sample|samples|proof)\b/i;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'can',
  'cost',
  'costs',
  'fee',
  'fees',
  'for',
  'from',
  'get',
  'give',
  'how',
  'is',
  'much',
  'need',
  'of',
  'photo',
  'physical',
  'please',
  'price',
  'prices',
  'pricing',
  'proof',
  'quote',
  'sample',
  'samples',
  'the',
  'to',
  'video',
  'we',
  'what',
]);

const TOKEN_ALIASES = {
  acrylics: 'acrylic',
  badges: 'badge',
  bags: 'bag',
  booklets: 'booklet',
  bottles: 'bottle',
  brochures: 'brochure',
  caps: 'cap',
  cards: 'card',
  certificates: 'certificate',
  coasters: 'coaster',
  coupons: 'coupon',
  decals: 'decal',
  displays: 'display',
  flyers: 'flyer',
  flasks: 'flask',
  gifts: 'gift',
  handouts: 'handout',
  holders: 'holder',
  keychains: 'keychain',
  lanyards: 'lanyard',
  leaflets: 'leaflet',
  mugs: 'mug',
  notebooks: 'notebook',
  notepads: 'notepad',
  pins: 'pin',
  polos: 'polo',
  postcards: 'postcard',
  posters: 'poster',
  pouches: 'pouch',
  stickers: 'sticker',
  tickets: 'ticket',
  totes: 'tote',
  tumblers: 'tumbler',
  umbrellas: 'umbrella',
  vouchers: 'voucher',
  wristbands: 'wristband',
};

function isSamplePricingQuery(query) {
  return SAMPLE_QUERY_PATTERN.test(query || '');
}

function getPreferredSampleType(query) {
  return /\b(photo|video|proof)\b/i.test(query || '')
    ? 'photo_sample'
    : 'physical_sample';
}

function normalizeToken(token) {
  let normalized = token.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!normalized) {
    return '';
  }

  if (TOKEN_ALIASES[normalized]) {
    return TOKEN_ALIASES[normalized];
  }

  if (normalized.length > 4 && normalized.endsWith('ies')) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.length > 4 && normalized.endsWith('es')) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.length > 3 && normalized.endsWith('s')) {
    normalized = normalized.slice(0, -1);
  }

  return TOKEN_ALIASES[normalized] || normalized;
}

function tokenize(text, { removeStopwords = true } = {}) {
  return (text || '')
    .split(/[^a-zA-Z0-9]+/)
    .map(normalizeToken)
    .filter((token) => token && (!removeStopwords || !STOPWORDS.has(token)));
}

function getRowTokens(row) {
  return new Set(tokenize(`${row.item_key} ${row.item_name}`, { removeStopwords: false }));
}

function scoreRow(row, queryTokens, preferredSampleType) {
  const rowTokens = getRowTokens(row);
  let score = row.sample_type === preferredSampleType ? 2 : -2;
  let matchedTokens = 0;

  for (const token of queryTokens) {
    if (rowTokens.has(token)) {
      score += 3;
      matchedTokens += 1;
      continue;
    }

    const hasPartialMatch = [...rowTokens].some((rowToken) => (
      token.length > 3
      && rowToken.length > 3
      && (rowToken.includes(token) || token.includes(rowToken))
    ));

    if (hasPartialMatch) {
      score += 1;
      matchedTokens += 1;
    }
  }

  return { score, matchedTokens };
}

function findFallbackRule(rows, preferredSampleType, queryTokens) {
  if (preferredSampleType === 'photo_sample') {
    return rows.find((row) => row.item_key === 'photo_sample_default') || null;
  }

  if (queryTokens.length === 0) {
    return rows.find((row) => row.item_key === 'standard_physical_corporate_gifts_default') || null;
  }

  return null;
}

function parseMoney(value) {
  return value === null || value === undefined ? null : Number(value);
}

function formatSampleRow(row, match = null) {
  return {
    item_key: row.item_key,
    item_name: row.item_name,
    sample_type: row.sample_type,
    pricing_group: row.pricing_group,
    pricing_mode: row.pricing_mode,
    fee: {
      amount_ex_gst: parseMoney(row.sample_price_ex_gst),
      currency: row.currency || 'SGD',
      gst_applicable: Boolean(row.gst_applicable),
    },
    requires_supplier_check: Boolean(row.requires_supplier_check),
    conditions: row.conditions || null,
    exclusions: row.exclusions || null,
    lead_time: {
      days_min: row.lead_time_days_min,
      days_max: row.lead_time_days_max,
      basis: row.lead_time_basis,
    },
    policies: {
      waiver_policy: row.waiver_policy,
      refund_policy: row.refund_policy,
      design_change_policy: row.design_change_policy,
      design_change_fee_ex_gst: parseMoney(row.design_change_fee_ex_gst),
      requires_return: Boolean(row.requires_return),
      return_window_days: row.return_window_days,
    },
    match: match
      ? {
          score: match.score,
          matched_tokens: match.matchedTokens,
        }
      : null,
  };
}

async function searchSamplePricing(query, options = {}) {
  const { limit = 5 } = options;

  if (!supabase) {
    throw new Error('Database not configured');
  }

  const preferredSampleType = getPreferredSampleType(query);
  const queryTokens = [...new Set(tokenize(query))];

  const { data, error } = await supabase
    .from('sample_pricing')
    .select(`
      item_key,
      item_name,
      sample_type,
      pricing_group,
      pricing_mode,
      sample_price_ex_gst,
      currency,
      gst_applicable,
      requires_supplier_check,
      conditions,
      exclusions,
      lead_time_days_min,
      lead_time_days_max,
      lead_time_basis,
      waiver_policy,
      refund_policy,
      design_change_policy,
      design_change_fee_ex_gst,
      requires_return,
      return_window_days
    `)
    .eq('active', true);

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  const rows = data || [];
  const scoredRows = rows
    .map((row) => ({
      row,
      match: scoreRow(row, queryTokens, preferredSampleType),
    }))
    .filter(({ row, match }) => (
      row.sample_type === preferredSampleType
      && queryTokens.length > 0
      && match.matchedTokens > 0
      && match.score > 0
    ))
    .sort((a, b) => b.match.score - a.match.score || a.row.item_name.localeCompare(b.row.item_name));

  if (scoredRows.length > 0) {
    return scoredRows.slice(0, limit).map(({ row, match }) => formatSampleRow(row, match));
  }

  const fallbackRule = findFallbackRule(rows, preferredSampleType, queryTokens);
  return fallbackRule ? [formatSampleRow(fallbackRule)] : [];
}

module.exports = {
  isSamplePricingQuery,
  searchSamplePricing,
};
