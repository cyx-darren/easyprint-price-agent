const Anthropic = require('@anthropic-ai/sdk');

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic()
  : null;

/**
 * Parse a natural language pricing query into structured parameters
 * Uses Claude to extract product, quantity, print option, and lead time
 *
 * @param {string} query - Natural language query
 * @returns {Promise<object>} Parsed query parameters
 */
async function parseQuery(query) {
  if (!anthropic) {
    throw new Error('Anthropic API key not configured');
  }

  const systemPrompt = `You are a query parser for a corporate gifts pricing system.

Extract the following from the user's query:
- product: The product name or type (e.g., "canvas tote bag", "tumbler", "notebook")
- quantity: The number of items requested (null if not specified)
- print_option: The FULL printing specification including color count. Examples:
  - "silkscreen 1c x 0c" means 1 color front, 0 colors back
  - "silkscreen 2c x 1c" means 2 colors front, 1 color back
  - "heat transfer" for full color heat transfer
  - "no print" for blank items
  - Keep the exact color notation like "1c x 0c", "2c x 2c" if mentioned
- lead_time: The delivery preference if mentioned ("local", "overseas", "urgent", "standard")

Respond in JSON format only:
{
  "product": "...",
  "quantity": null or number,
  "print_option": null or "..." (include full spec like "silkscreen 1c x 0c"),
  "lead_time": null or "..."
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: query
        }
      ],
      system: systemPrompt
    });

    let content = response.content[0].text;

    // Strip markdown code blocks if present
    content = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    return JSON.parse(content);
  } catch (error) {
    console.error('Query parsing error:', error);
    throw new Error('Failed to parse query');
  }
}

/**
 * Match parsed print option to database print options
 *
 * @param {string} parsedOption - Parsed print option from query
 * @param {Array} availableOptions - Available options from database
 * @returns {string|null} Best matching option
 */
function matchPrintOption(parsedOption, availableOptions) {
  // TODO: Implement fuzzy matching for print options
  throw new Error('Not implemented');
}

module.exports = {
  parseQuery,
  matchPrintOption
};
