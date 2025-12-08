import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.PRICE_AGENT_BACKEND_URL || 'http://localhost:3001',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.PRICE_AGENT_API_KEY}`,
  },
});

export default {
  async query(queryText, context = {}) {
    try {
      const response = await apiClient.post('/api/price/query', {
        query: queryText,
        context: {
          source: 'discord_bot',
          ...context,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Price API error:', error.message);
      if (error.response) {
        return error.response.data;
      }
      throw error;
    }
  },

  async lookup(params) {
    try {
      const response = await apiClient.post('/api/price/lookup', params);
      return response.data;
    } catch (error) {
      console.error('Price lookup error:', error.message);
      throw error;
    }
  },

  async getProductTiers(productName, printOption, leadTime) {
    try {
      const response = await apiClient.get(
        `/api/price/product/${encodeURIComponent(productName)}/tiers`,
        { params: { print_option: printOption, lead_time: leadTime } }
      );
      return response.data;
    } catch (error) {
      console.error('Get tiers error:', error.message);
      throw error;
    }
  },
};
