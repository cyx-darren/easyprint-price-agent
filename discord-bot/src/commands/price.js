import priceApi from '../services/priceApi.js';
import { formatPriceResponse, formatErrorResponse } from '../utils/formatters.js';

export default {
  name: 'price',
  description: 'Get pricing for corporate gift products',

  async execute(message, args) {
    if (!args.length) {
      return message.reply(
        '**Please specify a product.**\n' +
        'Usage: `!price <product> [quantity] [print option]`\n' +
        'Example: `!price canvas tote bag 500 silkscreen`'
      );
    }

    const query = args.join(' ');

    try {
      // Show typing indicator
      await message.channel.sendTyping();

      // Call Price Agent Backend API
      const response = await priceApi.query(query, {
        discordUserId: message.author.id,
        discordChannelId: message.channel.id,
      });

      if (response.success) {
        const formattedResponse = formatPriceResponse(response.data, response.meta);
        await message.reply(formattedResponse);
      } else {
        const errorResponse = formatErrorResponse(response.error);
        await message.reply(errorResponse);
      }
    } catch (error) {
      console.error('Price command error:', error);
      await message.reply('Could not fetch pricing. Please try again later.');
    }
  },
};
