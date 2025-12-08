import { EmbedBuilder } from 'discord.js';

export function formatPriceResponse(data, meta) {
  if (data.products_found === 0) {
    return formatNoResults(data);
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

  return formatNoResults(data);
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
    value: 'Try: `!price A4 canvas cream tote 500 silkscreen`',
    inline: false,
  });

  embed.setFooter({ text: 'Prices before GST | EasyPrint' }).setTimestamp();

  return { embeds: [embed] };
}

function formatNoResults(data) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('No products found')
    .setDescription(data.meta?.message || 'No matches for your search.');

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
