const { supabase } = require('./supabase');

// Custom heat transfer (dye sublimation) lanyards are priced by the Supabase
// calculator (heat_transfer_lanyard_prices view + calculate_heat_transfer_lanyard_price
// function), not by static rows in the pricing table. Ready stock lanyards
// remain normal catalogue products, so those queries fall through.
const LANYARD_PATTERN = /\blanyards?\b/i;
const HEAT_TRANSFER_PATTERN = /heat[\s-]*transfer|dye[\s-]*sub(?:limation)?\b|sublimation/i;
const READY_STOCK_PATTERN = /ready[\s-]*stock/i;

const DEFAULT_ATTACHMENT = 'lobster claw';
const PRODUCT_NAME = 'Heat Transfer (Dye Sublimation) Lanyard';

// Base attachments, longest/most specific phrasing first.
const BASE_ATTACHMENTS = [
  { pattern: /double\s+lobster\s+claw/i, value: 'double lobster claw' },
  { pattern: /black\s+oval\s+hook/i, value: 'black oval hook' },
  { pattern: /double\s+oval\s+hook/i, value: 'double oval hook' },
  { pattern: /oval\s+hook/i, value: 'oval hook' },
  { pattern: /black\s+square\s+clip/i, value: 'black square clip' },
  { pattern: /double\s+square\s+clip/i, value: 'double square clip' },
  { pattern: /square\s+clip/i, value: 'square clip' },
  { pattern: /j[\s-]*clip/i, value: 'j-clip' },
  { pattern: /key[\s-]*ring/i, value: 'keyring' },
  { pattern: /lobster\s+claw/i, value: 'lobster claw' },
];

const ADDONS = [
  { pattern: /safety\s+breakaway|breakaway/i, value: 'safety breakaway' },
  { pattern: /buckle\s+clip|buckle/i, value: 'buckle clip' },
  { pattern: /mobile\s+loop|phone\s+loop/i, value: 'mobile loop' },
];

function isHeatTransferLanyardQuery(query) {
  const text = query || '';
  return (
    LANYARD_PATTERN.test(text)
    && HEAT_TRANSFER_PATTERN.test(text)
    && !READY_STOCK_PATTERN.test(text)
  );
}

/**
 * Map free text to a canonical lanyard_component_costs attachment_type.
 * Add-ons are appended in the canonical order used by the cost table.
 */
function parseAttachment(query) {
  const text = query || '';

  let base = null;
  const hasReel = /retractable\s+reel/i.test(text);
  if (hasReel) {
    const reel = /no\s+print/i.test(text)
      ? 'retractable reel (no print)'
      : 'retractable reel (logo print)';
    base = /lobster\s+claw/i.test(text) ? `lobster claw + ${reel}` : reel;
  } else {
    for (const candidate of BASE_ATTACHMENTS) {
      if (candidate.pattern.test(text)) {
        base = candidate.value;
        break;
      }
    }
  }

  const parts = [base || DEFAULT_ATTACHMENT];
  // Reel combos in the cost table have no add-on variants beyond the base
  // pairs handled above, except the plain reel bases which do.
  for (const addon of ADDONS) {
    if (addon.pattern.test(text)) {
      parts.push(addon.value);
    }
  }

  return {
    attachmentType: parts.join(' + '),
    explicit: base !== null,
  };
}

function parseFreightType(query) {
  const text = query || '';
  if (/\bsea\b|sea\s+freight/i.test(text)) return 'sea';
  if (/\bair\b|air\s+freight/i.test(text)) return 'air';
  return null;
}

/**
 * Detect the lanyard width: 1.5cm/15mm -> 15, 2.5cm/25mm -> 25, 2cm/20mm -> 20.
 * Returns null when the query does not name a width (caller defaults to 20).
 */
function parseWidth(query) {
  const text = query || '';
  if (/\b1\.5\s*cm\b|\b15\s*mm\b/i.test(text)) return 15;
  if (/\b2\.5\s*cm\b|\b25\s*mm\b/i.test(text)) return 25;
  if (/\b2\s*cm\b|\b20\s*mm\b/i.test(text)) return 20;
  return null;
}

/**
 * Extract the requested piece count, ignoring dimension-like numbers (2cm,
 * 90cm, 8mm) and print-colour notation (1c x 0c).
 */
function parseQuantity(query) {
  const text = (query || '')
    .replace(/\d+(?:\.\d+)?\s*(?:cm|mm)\b/gi, ' ')
    .replace(/\d+c\s*x\s*\d+c/gi, ' ')
    // detach unit suffixes such as "1000pcs" so the boundary match works
    .replace(/(\d)(pcs|pieces|pc|units|unit)\b/gi, '$1 $2');
  const matches = [...text.matchAll(/\b(\d{2,6})\b/g)].map((m) => parseInt(m[1], 10));
  return matches.length > 0 ? matches[0] : null;
}

function formatPriceRow(row) {
  return {
    freight_type: row.freight_type,
    quantity: row.quantity,
    unit_price_sgd: parseFloat(row.unit_price_sgd),
    total_price_sgd: parseFloat(row.total_price_sgd),
    currency: row.currency || 'SGD',
    moq: row.moq,
    lead_time: {
      type: row.freight_type === 'air' ? 'overseas_air' : 'overseas_sea',
      days_min: row.lead_time_days_min,
      days_max: row.lead_time_days_max,
      basis: 'working days',
    },
  };
}

async function getDesignCharges() {
  const { data, error } = await supabase
    .from('lanyard_design_charges')
    .select('qty_min, qty_max, charge_per_design')
    .order('qty_min', { ascending: true });

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return (data || []).map((row) => ({
    qty_min: row.qty_min,
    qty_max: row.qty_max,
    charge_per_design_sgd: parseFloat(row.charge_per_design),
  }));
}

/**
 * Quote a custom heat transfer lanyard from the Supabase calculator.
 * Returns exact quotes for the requested quantity (or MOQ tiers when no
 * quantity is given), the full standard tier tables, and design charge info.
 */
async function getHeatTransferLanyardQuote(query) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  const { attachmentType, explicit } = parseAttachment(query);
  const requestedFreight = parseFreightType(query);
  const requestedWidth = parseWidth(query);
  const widthMm = requestedWidth || 20;
  const quantity = parseQuantity(query);
  const freightTypes = requestedFreight ? [requestedFreight] : ['air', 'sea'];

  const { data: tierRows, error: tierError } = await supabase
    .from('heat_transfer_lanyard_prices')
    .select('*')
    .eq('attachment_type', attachmentType)
    .eq('width_mm', widthMm)
    .in('freight_type', freightTypes)
    .order('freight_type', { ascending: true })
    .order('quantity', { ascending: true });

  if (tierError) {
    throw new Error(`Database error: ${tierError.message}`);
  }

  if (!tierRows || tierRows.length === 0) {
    return null;
  }

  const quotes = [];
  if (quantity) {
    for (const freightType of freightTypes) {
      const { data: quoteRows, error: quoteError } = await supabase.rpc(
        'calculate_heat_transfer_lanyard_price',
        {
          p_attachment_type: attachmentType,
          p_quantity: quantity,
          p_freight_type: freightType,
          p_width_mm: widthMm,
        }
      );

      if (quoteError) {
        throw new Error(`Database error: ${quoteError.message}`);
      }

      if (quoteRows && quoteRows.length > 0) {
        quotes.push(formatPriceRow(quoteRows[0]));
      }
    }
  }

  const notes = [
    'Prices are in SGD before GST.',
    'MOQ 50 pcs by air freight (8-13 working days), 500 pcs by sea freight (15-30 working days); maximum 5,000 pcs.',
    'Design charge is an additional per-design fee (MOQ 30 pcs per design), subject to GST.',
  ];
  if (quantity && quotes.length === 0) {
    notes.push(`No published price for ${quantity} pcs${requestedFreight ? ` by ${requestedFreight} freight` : ''}; see tier tables for the available range.`);
  }
  if (!explicit) {
    notes.push('Attachment not specified; quoted with the default lobster claw attachment.');
  }
  if (!requestedWidth) {
    notes.push('Width not specified; quoted the default 2cm x 90cm (1.5cm and 2.5cm also available).');
  }

  return {
    product_name: PRODUCT_NAME,
    attachment_type: attachmentType,
    width_mm: widthMm,
    size_label: tierRows[0].size_label,
    requested_quantity: quantity,
    quotes,
    tiers: {
      air: tierRows.filter((row) => row.freight_type === 'air').map(formatPriceRow),
      sea: tierRows.filter((row) => row.freight_type === 'sea').map(formatPriceRow),
    },
    design_charges: await getDesignCharges(),
    notes,
  };
}

module.exports = {
  isHeatTransferLanyardQuery,
  getHeatTransferLanyardQuote,
};
