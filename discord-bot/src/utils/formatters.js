import { EmbedBuilder } from 'discord.js';

export function formatPriceResponse(data, meta) {
  if (data.query_type === 'sample_pricing') {
    return formatSamplePricingResponse(data, meta);
  }

  if (data.products_found === 0) {
    return formatNoResults(data, meta);
  }

  if (data.products_found === 1 && data.results && data.results[0]) {
    return formatSingleProduct(data.results[0], data.alternatives);
  }

  if (data.results && data.results.length > 1) {
    return formatMultipleProducts(data.results);
  }

  // Fallback for single result format
  if (data.results && data.results.length === 1) {
    return formatSingleProduct(data.results[0], data.alternatives);
  }

  return formatNoResults(data, meta);
}

function formatSamplePricingResponse(data, meta) {
  const results = data.sample_results || [];

  if (results.length === 0) {
    return formatNoSampleResults(meta);
  }

  if (results.length === 1) {
    return formatSingleSamplePricing(results[0]);
  }

  return formatMultipleSamplePricing(results);
}

function formatSingleSamplePricing(result) {
  const embed = new EmbedBuilder()
    .setColor(result.pricing_mode === 'supplier_check' ? 0xffaa00 : 0x00aa00)
    .setTitle(`Sample fee: ${result.item_name}`)
    .setDescription(formatSampleFee(result));

  const leadTime = formatLeadTime(result.lead_time);
  if (leadTime) {
    embed.addFields({
      name: 'Lead Time',
      value: leadTime,
      inline: true,
    });
  }

  if (result.requires_supplier_check) {
    embed.addFields({
      name: 'Supplier Check',
      value: 'Confirm with supplier/factory before quoting as final.',
      inline: false,
    });
  }

  const policies = formatSamplePolicies(result.policies);
  if (policies) {
    embed.addFields({
      name: 'Policies',
      value: policies,
      inline: false,
    });
  }

  if (result.conditions) {
    embed.addFields({
      name: 'Applies To',
      value: truncateField(result.conditions),
      inline: false,
    });
  }

  if (result.exclusions) {
    embed.addFields({
      name: 'Excludes',
      value: truncateField(result.exclusions),
      inline: false,
    });
  }

  embed.setFooter({ text: getSampleFooter(result) }).setTimestamp();

  return { embeds: [embed] };
}

function formatMultipleSamplePricing(results) {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Found ${results.length} sample pricing rules`)
    .setDescription('Be more specific for the exact sample fee.');

  results.slice(0, 5).forEach((result, index) => {
    const details = [
      formatSampleFee(result, { compact: true }),
      formatLeadTime(result.lead_time),
      result.requires_supplier_check ? 'Supplier/factory check required' : null,
    ].filter(Boolean).join('\n');

    embed.addFields({
      name: `${index + 1}. ${result.item_name}`,
      value: details || 'N/A',
      inline: false,
    });
  });

  embed.addFields({
    name: 'Tip',
    value: 'Try: `@Easyprint-Price-Agent sample fee of postcard`',
    inline: false,
  });

  embed.setFooter({ text: 'Sample prices before GST where applicable | EasyPrint' }).setTimestamp();

  return { embeds: [embed] };
}

function formatNoSampleResults(meta) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('No sample pricing found')
    .setDescription(meta?.message || 'No matching sample pricing rule found.');

  embed.setFooter({ text: 'Try: @Easyprint-Price-Agent sample fee of postcard' });

  return { embeds: [embed] };
}

function formatSampleFee(result, options = {}) {
  const { compact = false } = options;
  const amount = result.fee?.amount_ex_gst;
  const currency = result.fee?.currency || 'SGD';
  const gstText = result.fee?.gst_applicable ? ' before GST' : '';

  if (result.pricing_mode === 'supplier_check') {
    return compact ? 'Supplier/factory check required' : '**Supplier/factory check required**';
  }

  if (result.pricing_mode === 'free' || amount === 0) {
    return compact ? 'Complimentary' : '**Complimentary / $0**';
  }

  if (amount !== null && amount !== undefined) {
    const price = `$${Number(amount).toFixed(2)} ${currency}${gstText}`;
    return compact ? price : `**${price}**`;
  }

  return compact ? 'Check supplier/factory' : '**Check supplier/factory**';
}

function formatLeadTime(leadTime) {
  if (!leadTime) {
    return null;
  }

  const { days_min: min, days_max: max, basis } = leadTime;

  if (min && max) {
    return min === max ? `${min} working days` : `${min}-${max} working days`;
  }

  if (basis && basis !== 'case_by_case') {
    return humanizePolicy(basis);
  }

  return null;
}

function formatSamplePolicies(policies) {
  if (!policies) {
    return null;
  }

  const lines = [
    policies.waiver_policy ? `Waiver: ${humanizePolicy(policies.waiver_policy)}` : null,
    policies.refund_policy ? `Refund: ${humanizePolicy(policies.refund_policy)}` : null,
    policies.design_change_policy ? `Design changes: ${humanizePolicy(policies.design_change_policy)}` : null,
    policies.design_change_fee_ex_gst !== null && policies.design_change_fee_ex_gst !== undefined
      ? `Design change fee: $${Number(policies.design_change_fee_ex_gst).toFixed(2)}`
      : null,
    policies.requires_return
      ? `Return required${policies.return_window_days ? ` within ${policies.return_window_days} days` : ''}`
      : null,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

function humanizePolicy(value) {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function truncateField(value, maxLength = 900) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function getSampleFooter(result) {
  return result.fee?.gst_applicable
    ? 'Sample prices before GST | EasyPrint'
    : 'Sample pricing | EasyPrint';
}

function formatSingleProduct(result, alternatives) {
  const embed = new EmbedBuilder()
    .setColor(0x00aa00)
    .setTitle(`${result.product_name}`)
    .setDescription(result.dimensions ? `${result.dimensions}` : '');

  // Print option and lead time
  if (result.print_option) {
    embed.addFields({
      name: 'Print Option',
      value: result.print_option,
      inline: true,
    });
  }

  if (result.lead_time) {
    embed.addFields({
      name: 'Lead Time',
      value: result.lead_time.description || `${result.lead_time.type}`,
      inline: true,
    });
  }

  // Pricing
  if (result.pricing) {
    const priceText =
      `**${result.pricing.requested_quantity} pcs @ $${result.pricing.unit_price}/pc**\n` +
      `Total: **$${result.pricing.total_price.toFixed(2)} ${result.pricing.currency || 'SGD'}**`;
    embed.addFields({
      name: 'Price',
      value: priceText,
      inline: false,
    });
  }

  // MOQ
  if (result.moq) {
    embed.addFields({
      name: 'MOQ',
      value: `${result.moq.quantity} pcs @ $${result.moq.unit_price}/pc`,
      inline: true,
    });
  }

  // Quantity tiers
  if (result.all_tiers && result.all_tiers.length > 0) {
    const tiersTable = result.all_tiers
      .slice(0, 8) // Limit to 8 tiers
      .map((tier) => {
        const marker =
          result.pricing && tier.quantity === result.pricing.requested_quantity
            ? '> '
            : '  ';
        const moqLabel = result.moq && tier.quantity === result.moq.quantity ? ' (MOQ)' : '';
        return `${marker}${tier.quantity}${moqLabel}: $${tier.unit_price}/pc`;
      })
      .join('\n');

    embed.addFields({
      name: 'Quantity Tiers',
      value: '```\n' + tiersTable + '\n```',
      inline: false,
    });
  }

  // Alternatives
  if (alternatives && alternatives.length > 0) {
    const altText = alternatives
      .slice(0, 3)
      .map((alt) => `- ${alt.print_option} (from $${alt.moq_price || alt.unit_price_at_500 || 'N/A'})`)
      .join('\n');

    embed.addFields({
      name: 'Other Print Options',
      value: altText,
      inline: false,
    });
  }

  embed.setFooter({ text: 'Prices before GST | EasyPrint' }).setTimestamp();

  return { embeds: [embed] };
}

function formatMultipleProducts(results) {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Found ${results.length} products`)
    .setDescription('Be more specific for detailed pricing.');

  results.slice(0, 5).forEach((result, index) => {
    const moqInfo = result.moq
      ? `MOQ: ${result.moq.quantity} pcs | Starting: $${result.moq.unit_price}/pc`
      : '';
    const dimensions = result.dimensions ? `${result.dimensions}` : '';

    embed.addFields({
      name: `${index + 1}. ${result.product_name}`,
      value: [dimensions, moqInfo].filter(Boolean).join('\n') || 'N/A',
      inline: false,
    });
  });

  embed.addFields({
    name: 'Tip',
    value: 'Try: `@Easyprint-Price-Agent A4 canvas cream tote 500 silkscreen`',
    inline: false,
  });

  embed.setFooter({ text: 'Prices before GST | EasyPrint' }).setTimestamp();

  return { embeds: [embed] };
}

function formatNoResults(data, meta) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('No products found')
    .setDescription(meta?.message || data.meta?.message || 'No matches for your search.');

  if (data.suggestions && data.suggestions.length > 0) {
    embed.addFields({
      name: 'Did you mean?',
      value: data.suggestions.map((s) => `- ${s}`).join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Try a different search term' });

  return { embeds: [embed] };
}

export function formatErrorResponse(error) {
  return `**Error:** ${error.message || 'Something went wrong'}`;
}
