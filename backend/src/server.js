require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pricingRoutes = require('./routes/pricing');
const { supabase } = require('./services/supabase');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint (Railway uses /health)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';

  if (supabase) {
    try {
      const { count, error } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true });

      dbStatus = error ? 'error' : 'connected';
    } catch {
      dbStatus = 'error';
    }
  }

  res.json({
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    database: dbStatus,
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api/price', pricingRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'SERVER_ERROR',
      message: 'Internal server error'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Price Agent running on port ${PORT}`);
});
