# Price Agent - Product Requirements Document

## Implementation Status

> **Last Updated:** December 2024

| Component | Status | Notes |
|-----------|--------|-------|
| **Backend API** | ✅ Complete | Express.js server deployed on Railway |
| **Database Schema** | ✅ Complete | products + pricing tables in Supabase |
| **POST /api/price/query** | ✅ Complete | Natural language queries via Claude |
| **POST /api/price/batch** | ✅ Complete | Canonical name lookup for Orchestrator |
| **POST /api/price/lookup** | ✅ Complete | Direct structured lookup |
| **GET /api/price/products** | ✅ Complete | List products with pagination |
| **GET /api/price/product/:name/tiers** | ✅ Complete | Pricing tiers for product |
| **GET /api/price/moq/:productName** | ✅ Complete | MOQ information |
| **Tiered Search** | ✅ Complete | Exact → Case-insensitive → Fuzzy w/ validation |
| **Lead Time Fallback** | ✅ Complete | local → overseas_air → overseas_sea |
| **Discord Bot** | ✅ Complete | !price command with embed responses |
| **Data Import** | ✅ Complete | CSV parsed and imported to Supabase |
| **Request/Response Logging** | ✅ Complete | Detailed logging on all endpoints |
| **Authentication** | ✅ Complete | Bearer token middleware |

---

## Overview

### Project Context
The Price Agent is part of EasyPrint's **AI Ticket Manager** multi-agent system. It serves as a specialist agent that provides pricing and MOQ (Minimum Order Quantity) information for corporate gift products.

### Purpose
Provide pricing and MOQ (Minimum Order Quantity) information for corporate gift products. The Price Agent:

1. **Receives queries** from the Ticket Manager (via orchestrator for `!ticket` or direct for `!price`)
2. **Parses natural language** to identify product, quantity, and print options
3. **Queries Supabase** for accurate pricing data
4. **Returns structured data** including quantity tiers, alternatives, and MOQ info

### Integration Points

The Price Agent has **two components**: a Discord bot and an API backend.

```
┌───────────────────────────────────────────────────────────────────────┐
│                         DISCORD SERVER                                 │
│                                                                        │
│   !ticket 80804                           !price canvas tote 500pcs   │
│        │                                           │                   │
└────────┼───────────────────────────────────────────┼───────────────────┘
         │                                           │
         ▼                                           ▼
┌─────────────────────┐                   ┌─────────────────────┐
│ Ticket Manager Bot  │                   │  Price Agent Bot    │
│                     │                   │                     │
│ • !ticket <id>      │                   │ • !price <query>    │
│ • Orchestrates      │                   │ • Direct pricing    │
│   multiple agents   │                   │   lookups           │
└─────────┬───────────┘                   └─────────┬───────────┘
          │                                         │
          ▼                                         │
┌─────────────────────┐                             │
│    Orchestrator     │                             │
│      Backend        │                             │
└─────────┬───────────┘                             │
          │                                         │
          ├──► KB Agent API                         │
          │                                         │
          ├──► Price Agent API ◄────────────────────┘
          │         │
          │         ▼
          │   ┌─────────────────┐
          │   │  Price Agent    │
          │   │  Backend        │
          │   │  (Express.js)   │
          │   └────────┬────────┘
          │            │
          └──► Artwork Agent API
                       │
                       ▼
              ┌─────────────────┐
              │    Supabase     │
              │   (PostgreSQL)  │
              └─────────────────┘
```

**Two Access Methods:**
| Method | Trigger | Handler | Use Case |
|--------|---------|---------|----------|
| Via Orchestrator | `!ticket <id>` | Ticket Manager Bot → Orchestrator → Price Agent API | Auto-detected pricing questions in tickets |
| Direct Command | `!price <query>` | Price Agent Bot → Price Agent API | Manual price lookups by support staff |

**Why Separate Bots?**
- Clear separation of concerns
- Each bot has a single responsibility
- Independent deployment and scaling
- Easier debugging and maintenance

---

## System Architecture

### Tech Stack
| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ |
| Framework | Express.js |
| Database | Supabase (PostgreSQL) |
| LLM | Claude (Anthropic) - for query understanding |
| Hosting | Railway |

### Project Structure (Implemented)
```
price-agent-v1/
├── backend/                        # Express API server ✅
│   ├── src/
│   │   ├── server.js               # Express server entry point
│   │   ├── routes/
│   │   │   └── pricing.js          # All API route handlers (6 endpoints)
│   │   ├── services/
│   │   │   ├── supabase.js         # Supabase client configuration
│   │   │   ├── productSearch.js    # Tiered product search logic
│   │   │   ├── priceQuery.js       # Pricing lookup & MOQ logic
│   │   │   └── queryParser.js      # Claude-based NL parsing
│   │   └── utils/
│   │       └── formatters.js       # API response formatting
│   ├── package.json                # Dependencies: express, @supabase/supabase-js, @anthropic-ai/sdk
│   └── node_modules/
│
├── discord-bot/                    # Discord bot for !price command ✅
│   ├── src/
│   │   ├── index.js                # Bot entry point (ES modules)
│   │   ├── commands/
│   │   │   └── price.js            # !price command handler
│   │   ├── services/
│   │   │   └── priceApi.js         # Axios client for backend API
│   │   └── utils/
│   │       └── formatters.js       # Discord embed formatting
│   ├── package.json                # Dependencies: discord.js, axios, dotenv
│   └── node_modules/
│
├── scripts/                        # Data import utilities ✅
│   ├── importData.js               # Main CSV import script
│   ├── parseAndGenerateSQL.js      # CSV → SQL generator
│   ├── generatePricingSQL.js       # Pricing SQL generator
│   ├── generateBulkSQL.js          # Bulk insert generator
│   └── generateSmallBatchSQL.js    # Small batch generator
│
├── imported_pricing/               # Source pricing data ✅
│   └── pricing.csv                 # EasyPrint pricing CSV (103KB)
│
├── docs/
│   ├── PRICE_AGENT_PRD.md          # This document
│   └── DATA_IMPORT_INSTRUCTIONS.md # CSV parsing documentation
│
├── .gitignore
└── railway.json                    # Railway deployment config
```

---

## Database Schema

### Table: products
Stores unique products (without print option variations).

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- "A4 Canvas Cream Tote Bag"
  category TEXT,                         -- "Tote Bags"
  dimensions TEXT,                       -- "33cmH x 30cmL"
  material TEXT,                         -- "Canvas"
  color TEXT,                            -- "Cream"
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_product_name UNIQUE (name)
);

-- Index for text search
CREATE INDEX idx_products_name_search ON products USING gin(to_tsvector('english', name));
CREATE INDEX idx_products_category ON products(category);
```

### Table: pricing
Stores all price points (product × print option × lead time × quantity).

```sql
CREATE TABLE pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Product reference
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,            -- Denormalized for fast queries
  
  -- Print option
  print_option TEXT NOT NULL,            -- "silkscreen print - 1c x 0c"
  
  -- Lead time
  lead_time_type TEXT NOT NULL,          -- "local", "overseas_air", "overseas_sea"
  lead_time_days_min INT,                -- 5
  lead_time_days_max INT,                -- 10
  
  -- Quantity tier
  quantity INT NOT NULL,                 -- 30, 40, 50, ... 2000
  
  -- Price
  unit_price DECIMAL(10,2) NOT NULL,     -- 4.42
  currency TEXT DEFAULT 'SGD',
  
  -- Flags
  is_moq BOOLEAN DEFAULT FALSE,          -- TRUE for minimum order quantity row
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_pricing_product_id ON pricing(product_id);
CREATE INDEX idx_pricing_product_name ON pricing(product_name);
CREATE INDEX idx_pricing_lookup ON pricing(product_name, print_option, lead_time_type, quantity);
CREATE INDEX idx_pricing_moq ON pricing(product_id, is_moq) WHERE is_moq = TRUE;
CREATE INDEX idx_pricing_print_option ON pricing(print_option);
CREATE INDEX idx_pricing_lead_time ON pricing(lead_time_type);

-- Text search on product name
CREATE INDEX idx_pricing_name_search ON pricing USING gin(to_tsvector('english', product_name));
```

### Lead Time Types Reference
| Type | Description | Days |
|------|-------------|------|
| `local` | Local printing | 5-10 working days |
| `overseas_air` | Overseas (Air freight) | 10-15 working days |
| `overseas_sea` | Overseas (Sea freight) | 20-35 working days |

---

## API Specification

### Base URL
```
Production: https://price-agent.up.railway.app
Local: http://localhost:3001
```

### Authentication
All requests require an API key in the header:
```
Authorization: Bearer <PRICE_AGENT_API_KEY>
```

---

### Endpoint: POST /api/price/batch

**Primary endpoint for Orchestrator** - accepts canonical product names (pre-resolved by Product Agent).

#### Request
```json
{
  "products": ["Hooded Sweatshirt", "100% Cotton T-Shirt"],
  "quantities": {
    "Hooded Sweatshirt": 500,
    "100% Cotton T-Shirt": 1500
  }
}
```

#### Response (Success)
```json
{
  "success": true,
  "results": [
    {
      "searchedTerm": "Hooded Sweatshirt",
      "found": true,
      "matchType": "exact",
      "product": {
        "name": "Hooded Sweatshirt",
        "pricing": {
          "quantity": 500,
          "unitPrice": 12.50,
          "totalPrice": 6250.00,
          "currency": "SGD"
        },
        "moq": {
          "quantity": 30,
          "print_option": "silkscreen print - 1c",
          "unit_price": 18.50
        },
        "leadTime": {
          "type": "local",
          "days_min": 5,
          "days_max": 10
        }
      }
    },
    {
      "searchedTerm": "100% Cotton T-Shirt",
      "found": true,
      "matchType": "exact",
      "product": { ... }
    }
  ]
}
```

#### Response (Fuzzy Match - includes warning)
```json
{
  "success": true,
  "results": [
    {
      "searchedTerm": "Canvas Tote Bag",
      "found": true,
      "matchType": "fuzzy",
      "warning": "Matched via fuzzy search - please verify product",
      "product": {
        "name": "A4 Canvas Cream Tote Bag",
        ...
      }
    }
  ]
}
```

#### Response (Not Found)
```json
{
  "success": false,
  "results": [
    {
      "searchedTerm": "Unknown Product XYZ",
      "found": false,
      "matchType": "not_found",
      "message": "No pricing found for \"Unknown Product XYZ\""
    }
  ]
}
```

#### Match Types
| matchType | Description |
|-----------|-------------|
| `exact` | Case-sensitive exact match on product name |
| `exact_insensitive` | Case-insensitive exact match (no wildcards) |
| `fuzzy` | Partial match with validation (50%+ word overlap required) |
| `not_found` | No matching product found |

---

### Endpoint: POST /api/price/query

Natural language pricing queries (used by Discord bot's `!price` command).

#### Request
```json
{
  "query": "What's the price for 500 canvas tote bags with silkscreen printing?",
  "context": {
    "ticketId": "80804",
    "sessionId": "ticket-mgr-12345"
  }
}
```

#### Response (Success)
```json
{
  "success": true,
  "data": {
    "products_found": 1,
    "results": [
      {
        "product_name": "A4 Canvas Cream Tote Bag",
        "dimensions": "33cmH x 30cmL",
        "category": "Tote Bags",
        "print_option": "silkscreen print - 1c x 0c",
        "lead_time": {
          "type": "local",
          "description": "5-10 working days"
        },
        "pricing": {
          "requested_quantity": 500,
          "unit_price": 2.01,
          "total_price": 1005.00,
          "currency": "SGD"
        },
        "moq": {
          "quantity": 30,
          "unit_price": 4.42
        },
        "all_tiers": [
          {"quantity": 30, "unit_price": 4.42},
          {"quantity": 50, "unit_price": 3.46},
          {"quantity": 100, "unit_price": 2.68},
          {"quantity": 500, "unit_price": 2.01},
          {"quantity": 1000, "unit_price": 1.75}
        ]
      }
    ],
    "alternatives": [
      {
        "product_name": "A4 Canvas Black Tote Bag",
        "print_option": "silkscreen print - 1c x 0c",
        "unit_price_at_500": 2.23
      }
    ]
  },
  "meta": {
    "query_parsed": {
      "product": "canvas tote bag",
      "quantity": 500,
      "print_option": "silkscreen"
    },
    "match_type": "exact",
    "processing_time_ms": 145,
    "warning": null
  }
}
```

#### Response (No Results)
```json
{
  "success": true,
  "data": {
    "products_found": 0,
    "results": [],
    "suggestions": [
      "A4 Canvas Cream Tote Bag",
      "A3 Canvas Cream Tote Bag",
      "A4 Canvas Black Tote Bag"
    ]
  },
  "meta": {
    "query_parsed": {
      "product": "leather bag",
      "quantity": null,
      "print_option": null
    },
    "match_type": null,
    "message": "No exact matches found. Did you mean one of these products?",
    "warning": null
  }
}
```

#### Response (Error)
```json
{
  "success": false,
  "error": {
    "code": "INVALID_QUERY",
    "message": "Could not parse product from query"
  }
}
```

---

### Endpoint: POST /api/price/lookup

Direct lookup endpoint for structured queries (no NLP processing).

#### Request
```json
{
  "product_name": "A4 Canvas Cream Tote Bag",
  "print_option": "silkscreen print - 1c x 0c",
  "lead_time_type": "local",
  "quantity": 500
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "product_name": "A4 Canvas Cream Tote Bag",
    "print_option": "silkscreen print - 1c x 0c",
    "lead_time_type": "local",
    "quantity": 500,
    "unit_price": 2.01,
    "total_price": 1005.00,
    "currency": "SGD",
    "moq": {
      "quantity": 30,
      "unit_price": 4.42
    }
  }
}
```

---

### Endpoint: GET /api/price/products

List all available products.

#### Request
```
GET /api/price/products?category=Tote%20Bags&limit=20
```

#### Response
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "uuid-1",
        "name": "A4 Canvas Cream Tote Bag",
        "category": "Tote Bags",
        "dimensions": "33cmH x 30cmL",
        "print_options": [
          "No Print",
          "silkscreen print - 1c x 0c",
          "silkscreen print - 2c x 0c",
          "full colour heat transfer print 8cm x 8cm"
        ],
        "moq": 30,
        "starting_price": 2.75
      }
    ],
    "total": 45,
    "limit": 20,
    "offset": 0
  }
}
```

---

### Endpoint: GET /api/price/product/:name/tiers

Get all pricing tiers for a specific product variant.

#### Request
```
GET /api/price/product/A4%20Canvas%20Cream%20Tote%20Bag/tiers?print_option=silkscreen%20print%20-%201c%20x%200c&lead_time=local
```

#### Response
```json
{
  "success": true,
  "data": {
    "product_name": "A4 Canvas Cream Tote Bag",
    "print_option": "silkscreen print - 1c x 0c",
    "lead_time": {
      "type": "local",
      "days_min": 5,
      "days_max": 10
    },
    "tiers": [
      {"quantity": 30, "unit_price": 4.42, "is_moq": true},
      {"quantity": 40, "unit_price": 3.82, "is_moq": false},
      {"quantity": 50, "unit_price": 3.46, "is_moq": false},
      {"quantity": 100, "unit_price": 2.68, "is_moq": false},
      {"quantity": 500, "unit_price": 2.01, "is_moq": false},
      {"quantity": 1000, "unit_price": 1.75, "is_moq": false},
      {"quantity": 2000, "unit_price": 1.69, "is_moq": false}
    ]
  }
}
```

---

### Endpoint: GET /api/price/moq/:productName

Get MOQ information for a product across all variants.

#### Request
```
GET /api/price/moq/A4%20Canvas%20Cream%20Tote%20Bag
```

#### Response
```json
{
  "success": true,
  "data": {
    "product_name": "A4 Canvas Cream Tote Bag",
    "variants": [
      {
        "print_option": "No Print",
        "lead_time_type": "local",
        "moq": 30,
        "moq_price": 2.75
      },
      {
        "print_option": "silkscreen print - 1c x 0c",
        "lead_time_type": "local",
        "moq": 30,
        "moq_price": 4.42
      },
      {
        "print_option": "silkscreen print - 1c x 0c",
        "lead_time_type": "overseas_sea",
        "moq": 100,
        "moq_price": 2.20
      }
    ],
    "lowest_moq": {
      "quantity": 30,
      "print_option": "No Print",
      "unit_price": 2.75
    }
  }
}
```

---

### Endpoint: GET /api/health

Health check endpoint.

#### Response
```json
{
  "status": "healthy",
  "database": "connected",
  "version": "1.0.0",
  "timestamp": "2024-12-04T10:30:00Z"
}
```

---

## Query Parsing Logic

The Price Agent uses Claude (claude-sonnet-4-20250514) to parse natural language queries into structured parameters.

### Claude Prompt Template (Implemented)
```javascript
// From backend/src/services/queryParser.js

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

// Model: claude-sonnet-4-20250514
// Max tokens: 256
```

### Fuzzy Matching Rules

| User Input | Should Match |
|------------|--------------|
| "tote bag" | "A4 Canvas Cream Tote Bag", "A3 Canvas Black Tote Bag" |
| "canvas bag cream" | "A4 Canvas Cream Tote Bag", "A3 Canvas Cream Tote Bag" |
| "A4 tote" | "A4 Canvas Cream Tote Bag", "A4 Canvas Black Tote Bag" |
| "silkscreen 1 color" | "silkscreen print - 1c x 0c" |
| "2 color print both sides" | "silkscreen print - 2c x 2c" |
| "full color" | "full colour heat transfer print..." |

---

## Product Search Logic (Implemented)

### Tiered Search Strategy

The Price Agent uses a strict 3-tier search strategy to prevent returning wrong products.

**File:** `backend/src/services/productSearch.js`

| Tier | Method | Supabase Query | Description |
|------|--------|----------------|-------------|
| 1 | **Exact Match** | `.eq('name', query)` | Case-sensitive exact match |
| 2 | **Case-Insensitive Exact** | `.ilike('name', query)` | No wildcards, just case-insensitive |
| 3 | **Fuzzy Match + Validation** | `.ilike('name', '%word%')` for ALL words | Contains search with 50% word overlap validation |

### Implementation

```javascript
// From backend/src/services/productSearch.js

async function searchProducts(query, options = {}) {
  const { limit = 10, category = null } = options;
  const searchTerm = query.trim();

  console.log(`[SEARCH] Searching for: "${searchTerm}"`);

  // Tier 1: Exact match (case-sensitive)
  let result = await searchExact(searchTerm, category, limit);
  if (result.length > 0) {
    console.log(`[SEARCH] Found ${result.length} exact match(es)`);
    return result.map(r => ({ ...r, matchType: 'exact' }));
  }

  // Tier 2: Case-insensitive exact match (no wildcards)
  result = await searchExactInsensitive(searchTerm, category, limit);
  if (result.length > 0) {
    console.log(`[SEARCH] Found ${result.length} case-insensitive exact match(es)`);
    return result.map(r => ({ ...r, matchType: 'exact_insensitive' }));
  }

  // Tier 3: Fuzzy match with validation
  result = await searchFuzzy(searchTerm, category, limit);
  const validated = result.filter(r => validateMatch(searchTerm, r.name));

  if (validated.length > 0) {
    console.log(`[SEARCH] Found ${validated.length} validated fuzzy match(es)`);
    return validated.map(r => ({ ...r, matchType: 'fuzzy' }));
  }

  console.log(`[SEARCH] No matches found for "${searchTerm}"`);
  return [];
}
```

### Match Type Response

Each product result includes a `matchType` field:

| matchType | Description | Confidence |
|-----------|-------------|------------|
| `exact` | Case-sensitive exact match | Highest |
| `exact_insensitive` | Case-insensitive exact match | High |
| `fuzzy` | Validated fuzzy match (50%+ overlap) | Medium (includes warning) |
| `not_found` | No matching product found | N/A |

### Match Validation Function

```javascript
// Prevents returning wrong products for queries like "t-shirt and hoodie"

function validateMatch(searchTerm, foundProductName) {
  const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const productWords = foundProductName.toLowerCase().split(/\s+/);

  // If no significant search words, accept the match
  if (searchWords.length === 0) return true;

  // Calculate word overlap
  const matchingWords = searchWords.filter(sw =>
    productWords.some(pw => pw.includes(sw) || sw.includes(pw))
  );

  // Require at least 50% of search words to match
  const overlapRatio = matchingWords.length / searchWords.length;

  if (overlapRatio < 0.5) {
    console.warn(`[SEARCH] Rejecting low-confidence match: "${searchTerm}" → "${foundProductName}" (${(overlapRatio * 100).toFixed(0)}% overlap)`);
    return false;
  }

  return true;
}
```

### Lead Time Fallback (Implemented)

When pricing is not found for the default lead time (`local`), the system automatically falls back:

```javascript
// From backend/src/routes/pricing.js

// Fallback: If no local pricing found, try overseas_air
if (results.length === 0 && leadTimeType === 'local') {
  console.log('[PRICE-QUERY] No local pricing found, trying overseas_air...');
  leadTimeType = 'overseas_air';
  results = await getPricingForProducts({ products, quantity, printOption, leadTimeType });

  // Fallback: If still no results, try overseas_sea
  if (results.length === 0) {
    console.log('[PRICE-QUERY] No overseas_air pricing found, trying overseas_sea...');
    leadTimeType = 'overseas_sea';
    results = await getPricingForProducts({ products, quantity, printOption, leadTimeType });
  }
}
```

This ensures products with only overseas pricing are still returned.

---

## Price Selection Logic

### When Quantity is Specified
Return the tier that matches or is just below the requested quantity.

```sql
SELECT quantity, unit_price
FROM pricing
WHERE product_name = $1
  AND print_option = $2
  AND lead_time_type = $3
  AND quantity <= $4
ORDER BY quantity DESC
LIMIT 1;
```

### When Quantity is Not Specified
Return all tiers for the variant, highlighting the MOQ.

---

## Error Handling

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `INVALID_QUERY` | 400 | Could not parse the query |
| `PRODUCT_NOT_FOUND` | 404 | No matching products |
| `MISSING_PARAMETERS` | 400 | Required fields missing |
| `DATABASE_ERROR` | 500 | Supabase connection issue |
| `UNAUTHORIZED` | 401 | Invalid or missing API key |

---

## Environment Variables

### Discord Bot (discord-bot/.env)

```env
# Discord
DISCORD_BOT_TOKEN=your-price-agent-bot-token
DISCORD_CLIENT_ID=your-client-id
DISCORD_GUILD_ID=your-guild-id          # Optional: for development

# Backend API Connection
PRICE_AGENT_BACKEND_URL=https://price-agent-backend.up.railway.app
PRICE_AGENT_API_KEY=your-internal-api-key

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

### Backend API (backend/.env)

```env
# Server
PORT=3001
NODE_ENV=production

# Authentication
PRICE_AGENT_API_KEY=your-internal-api-key    # Same key as discord-bot uses

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Claude (for query parsing)
ANTHROPIC_API_KEY=your-anthropic-key

# Logging
LOG_LEVEL=info
```

### For Ticket Manager Orchestrator

Add these to the existing Ticket Manager backend:

```env
# Price Agent Connection (for !ticket command integration)
PRICE_AGENT_URL=https://price-agent-backend.up.railway.app
PRICE_AGENT_API_KEY=your-internal-api-key
```

---

## Integration with Orchestrator

### Recommended: Use /api/price/batch with Canonical Names

The Orchestrator should:
1. Extract product mentions from the ticket
2. Resolve them to canonical names via Product Agent (`/api/product/resolve`)
3. Call Price Agent's `/api/price/batch` with the canonical names

```javascript
// In orchestrator's price-agent.js

const axios = require('axios');

/**
 * Query Price Agent with canonical product names (recommended)
 * Use this after resolving product names via Product Agent
 */
async function queryPriceAgentBatch(products, quantities, context) {
  try {
    const response = await axios.post(
      `${process.env.PRICE_AGENT_URL}/api/price/batch`,
      {
        products,    // Array of canonical names: ["Hooded Sweatshirt", "100% Cotton T-Shirt"]
        quantities   // Object: { "Hooded Sweatshirt": 500, "100% Cotton T-Shirt": 1500 }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PRICE_AGENT_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    // Check for fuzzy matches and warn
    const fuzzyMatches = response.data.results.filter(r => r.matchType === 'fuzzy');
    if (fuzzyMatches.length > 0) {
      console.warn('Price Agent returned fuzzy matches - verify products:',
        fuzzyMatches.map(f => `${f.searchedTerm} → ${f.product?.name}`));
    }

    return response.data;
  } catch (error) {
    console.error('Price Agent error:', error.message);
    return {
      success: false,
      error: {
        code: 'PRICE_AGENT_UNAVAILABLE',
        message: 'Could not retrieve pricing information'
      }
    };
  }
}

/**
 * Query Price Agent with natural language (legacy)
 * Use for direct Discord bot queries
 */
async function queryPriceAgent(query, context) {
  try {
    const response = await axios.post(
      `${process.env.PRICE_AGENT_URL}/api/price/query`,
      {
        query,
        context: {
          ticketId: context.ticketId,
          sessionId: context.sessionId
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PRICE_AGENT_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    return response.data;
  } catch (error) {
    console.error('Price Agent error:', error.message);
    return {
      success: false,
      error: {
        code: 'PRICE_AGENT_UNAVAILABLE',
        message: 'Could not retrieve pricing information'
      }
    };
  }
}
```

---

## Discord Command: !price

The `!price` command is handled by the **Price Agent's own Discord bot**, which calls the Price Agent backend API.

### Command Syntax

```
!price <product query> [quantity] [print option]
```

### Examples

| Command | Description |
|---------|-------------|
| `!price canvas tote bag` | Show all options for canvas tote bags |
| `!price canvas tote 500` | Price for 500 canvas tote bags |
| `!price A4 tote bag 100 silkscreen` | Price for 100 A4 tote bags with silkscreen |
| `!price black tote 2 color print 200pcs` | Specific variant and quantity |
| `!price tumbler` | List all tumbler products and pricing |

### Discord Response Format

#### Single Product Match
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 A4 Canvas Cream Tote Bag
📐 33cmH x 30cmL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🖨️ Print: silkscreen print - 1c x 0c
📅 Lead Time: Local (5-10 working days)

💰 **500 pcs @ $2.01/pc = $1,005.00**

📊 All Quantity Tiers:
┌──────────┬────────────┬────────────┐
│ Quantity │ Unit Price │ Total      │
├──────────┼────────────┼────────────┤
│ 30 (MOQ) │ $4.42      │ $132.60    │
│ 50       │ $3.46      │ $173.00    │
│ 100      │ $2.68      │ $268.00    │
│ 250      │ $2.21      │ $552.50    │
│ **500**  │ **$2.01**  │ **$1,005** │
│ 1000     │ $1.75      │ $1,750.00  │
│ 2000     │ $1.69      │ $3,380.00  │
└──────────┴────────────┴────────────┘

🔗 Other print options available:
• No Print (from $2.75)
• silkscreen 2c x 0c (from $6.26)
• heat transfer 8x8cm (from $5.45)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Multiple Product Matches
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Found 4 products matching "canvas tote"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ **A4 Canvas Cream Tote Bag** (33cmH x 30cmL)
   MOQ: 30 pcs | Starting: $2.75/pc (No Print)
   
2️⃣ **A4 Canvas Black Tote Bag** (33cmH x 30cmL)
   MOQ: 30 pcs | Starting: $3.07/pc (No Print)
   
3️⃣ **A3 Canvas Cream Tote Bag** (42cmH x 38cmL x 8cmD)
   MOQ: 30 pcs | Starting: $3.06/pc (No Print)
   
4️⃣ **A3 Canvas Black Tote Bag** (42cmH x 38cmL x 8cmD)
   MOQ: 30 pcs | Starting: $3.35/pc (No Print)

💡 Tip: Be more specific, e.g.:
   !price A4 canvas cream tote 500 silkscreen
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### No Results
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ No products found for "leather bag"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Did you mean one of these?
• Canvas Tote Bag
• Non-woven Bag
• Drawstring Bag

💡 Try: !price tote bag
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### MOQ Query
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 A4 Canvas Cream Tote Bag - MOQ Options
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Local Printing (5-10 days):
┌─────────────────────────────┬─────┬────────┐
│ Print Option                │ MOQ │ Price  │
├─────────────────────────────┼─────┼────────┤
│ No Print                    │ 30  │ $2.75  │
│ silkscreen 1c x 0c          │ 30  │ $4.42  │
│ silkscreen 2c x 0c          │ 30  │ $6.26  │
│ silkscreen 2c x 1c          │ 30  │ $9.07  │
│ silkscreen 2c x 2c          │ 30  │ $11.77 │
│ heat transfer 8x8cm         │ 30  │ $5.45  │
│ heat transfer A5 1-side     │ 30  │ $6.39  │
│ heat transfer A4 1-side     │ 30  │ $6.88  │
└─────────────────────────────┴─────┴────────┘

✨ Lowest: No Print @ 30 pcs = $82.50 total
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Discord Bot Implementation (ES Modules)

**Note:** The Discord bot uses ES modules (`"type": "module"` in package.json).

#### Bot Entry Point (discord-bot/src/index.js)

```javascript
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import priceCommand from './commands/price.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '!';

client.once('ready', () => {
  console.log(`Price Agent Bot logged in as ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} guild(s)`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'price') {
    await priceCommand.execute(message, args);
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

#### Price Command Handler (discord-bot/src/commands/price.js)

```javascript
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
      await message.channel.sendTyping();

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
```

#### Backend API Client (discord-bot/src/services/priceApi.js)

```javascript
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
```

#### Response Formatter (discord-bot/src/utils/formatters.js)

```javascript
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

  if (result.print_option) {
    embed.addFields({ name: 'Print Option', value: result.print_option, inline: true });
  }

  if (result.lead_time) {
    embed.addFields({
      name: 'Lead Time',
      value: result.lead_time.description || `${result.lead_time.type}`,
      inline: true,
    });
  }

  if (result.pricing) {
    const priceText =
      `**${result.pricing.requested_quantity} pcs @ $${result.pricing.unit_price}/pc**\n` +
      `Total: **$${result.pricing.total_price.toFixed(2)} ${result.pricing.currency || 'SGD'}**`;
    embed.addFields({ name: 'Price', value: priceText, inline: false });
  }

  if (result.moq) {
    embed.addFields({
      name: 'MOQ',
      value: `${result.moq.quantity} pcs @ $${result.moq.unit_price}/pc`,
      inline: true,
    });
  }

  if (result.all_tiers && result.all_tiers.length > 0) {
    const tiersTable = result.all_tiers
      .slice(0, 8)
      .map((tier) => {
        const marker = result.pricing && tier.quantity === result.pricing.requested_quantity ? '> ' : '  ';
        const moqLabel = result.moq && tier.quantity === result.moq.quantity ? ' (MOQ)' : '';
        return `${marker}${tier.quantity}${moqLabel}: $${tier.unit_price}/pc`;
      })
      .join('\n');

    embed.addFields({ name: 'Quantity Tiers', value: '```\n' + tiersTable + '\n```', inline: false });
  }

  if (alternatives && alternatives.length > 0) {
    const altText = alternatives
      .slice(0, 3)
      .map((alt) => `- ${alt.print_option} (from $${alt.moq_price || alt.unit_price_at_500 || 'N/A'})`)
      .join('\n');
    embed.addFields({ name: 'Other Print Options', value: altText, inline: false });
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

  embed.addFields({ name: 'Tip', value: 'Try: `!price A4 canvas cream tote 500 silkscreen`', inline: false });
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
```

---

## Deployment

### Railway Configuration (Multi-Service)

The Price Agent runs as **two services** on Railway within the same project.

#### railway.json (root)
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  }
}
```

#### Service 1: Discord Bot

**Railway Service Name:** `price-agent-discord-bot`  
**Root Directory:** `/discord-bot`

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node src/index.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

#### Service 2: Backend API

**Railway Service Name:** `price-agent-backend`  
**Root Directory:** `/backend`

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node src/server.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

### Railway Project Structure

```
Railway Project: price-agent
├── Service: price-agent-discord-bot
│   ├── Source: /discord-bot
│   ├── Variables: DISCORD_BOT_TOKEN, PRICE_AGENT_BACKEND_URL, etc.
│   └── No public domain (internal service)
│
└── Service: price-agent-backend
    ├── Source: /backend
    ├── Variables: SUPABASE_URL, ANTHROPIC_API_KEY, etc.
    └── Public domain: price-agent-backend.up.railway.app
```

### Deployment Checklist

**Phase 1: Database Setup** ✅ COMPLETE
- [x] Create Supabase project (or use existing)
- [x] Run SQL to create `products` and `pricing` tables
- [x] Import pricing data from CSV (103KB pricing.csv)
- [x] Verify data with test queries

**Phase 2: Backend API** ✅ COMPLETE
- [x] Create Railway project "price-agent"
- [x] Add service "price-agent-backend" with root `/backend`
- [x] Set backend environment variables
- [x] Deploy and verify `/api/health` endpoint
- [x] Test API with sample queries via curl/Postman
- [x] Add detailed request/response logging
- [x] Implement tiered search strategy
- [x] Implement lead time fallback

**Phase 3: Discord Bot** ✅ COMPLETE
- [x] Create Discord application at discord.dev
- [x] Create bot and get token
- [x] Add bot to EasyPrint Discord server
- [x] Add service "price-agent-discord-bot" with root `/discord-bot`
- [x] Set discord-bot environment variables
- [x] Set `PRICE_AGENT_BACKEND_URL` to Railway backend URL
- [x] Deploy and verify bot comes online
- [x] Test `!price` command in Discord
- [x] Implement Discord embed formatting

**Phase 4: Integration** 🔄 PENDING
- [ ] Update Ticket Manager orchestrator with Price Agent backend URL
- [ ] Test `!ticket` command with pricing questions
- [ ] Verify both access methods work

---

## Testing

### Batch Endpoint Test Cases (for Orchestrator)

```bash
# Test 1: Exact match with canonical name
curl -X POST http://localhost:3001/api/price/batch \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"products": ["Silicone Wristband"], "quantities": {"Silicone Wristband": 500}}'
# Expected: matchType = "exact"

# Test 2: Multiple products
curl -X POST http://localhost:3001/api/price/batch \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"products": ["Landscape Canvas Tote Bag", "Silicone Wristband"], "quantities": {"Landscape Canvas Tote Bag": 100, "Silicone Wristband": 500}}'
# Expected: Both found with matchType = "exact"

# Test 3: Unknown product (should NOT return random products)
curl -X POST http://localhost:3001/api/price/batch \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"products": ["Unknown Product XYZ"], "quantities": {"Unknown Product XYZ": 100}}'
# Expected: matchType = "not_found", no random products returned

# Test 4: Fuzzy match scenario
curl -X POST http://localhost:3001/api/price/batch \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"products": ["Canvas Tote Bag"], "quantities": {"Canvas Tote Bag": 100}}'
# Expected: matchType = "fuzzy", warning = "Matched via fuzzy search..."
```

### Backend API Test Queries (Natural Language via /api/price/query)

| Query | Expected Result |
|-------|-----------------|
| "How much for 100 canvas tote bags?" | Returns A4/A3 Canvas Tote Bag options with prices at qty 100 |
| "MOQ for tote bags with silkscreen print" | Returns MOQ of 30 with price $4.42 |
| "Price list for A4 Canvas Cream Tote Bag" | Returns all print options and tiers |
| "500 black tote bags 2 color print" | Returns A4 Canvas Black Tote Bag, silkscreen 2c x 0c, $2.73/pc |
| "cheapest tote bag option" | Returns No Print option with lowest price tier |
| "t-shirt and hoodie 500 pcs" | Returns empty results (NOT tote bags!) - Bug fix verified |

### Discord Bot Test Cases

Test the `!price` command via the **Price Agent Bot**:

| Command | Expected Response |
|---------|-------------------|
| `!price` | Error: "Please specify a product" with usage hint |
| `!price canvas tote` | Embed with 4 canvas tote products, MOQ/starting prices |
| `!price A4 canvas cream tote 500` | Single product embed with all tiers, 500 highlighted |
| `!price A4 tote silkscreen 1 color 100` | A4 Canvas Tote with silkscreen 1c x 0c at qty 100 |
| `!price black tote 2c x 2c 300` | A4/A3 Canvas Black Tote options with 2c x 2c print |
| `!price leather bag` | "No products found" embed with suggestions |
| `!price tote moq` | All tote bag variants with their MOQ and starting prices |
| `!price A3 cream tote heat transfer` | A3 Canvas Cream with all heat transfer options |

### Integration Test (via Ticket Manager)

Test that the orchestrator correctly calls Price Agent:

| Ticket Content | Expected Behavior |
|----------------|-------------------|
| "What's the MOQ for canvas bags?" | Orchestrator detects PRICE intent, calls Price Agent API |
| "Price and info on tote bags" | Orchestrator detects MIXED intent, calls both KB + Price agents |
| "How does screen printing work?" | Orchestrator detects KNOWLEDGE intent, does NOT call Price Agent |

---

## Logging (Implemented)

All API endpoints include detailed request/response logging for debugging and monitoring.

### Log Format

```
[ENDPOINT-NAME] ========== NEW REQUEST ==========
[ENDPOINT-NAME] Key info about the request
[ENDPOINT-NAME] Step-by-step processing info
[ENDPOINT-NAME] ========== RESPONSE SENT (Xms) ==========
[ENDPOINT-NAME] Summary of response
```

### Example Log Output

```
[PRICE-QUERY] ========== NEW REQUEST ==========
[PRICE-QUERY] Query: "canvas tote bag 500 silkscreen"
[PRICE-QUERY] Context: {"source":"discord_bot","discordUserId":"123"}
[PRICE-QUERY] Parsed query:
[PRICE-QUERY]   - Product: "canvas tote bag"
[PRICE-QUERY]   - Quantity: 500
[PRICE-QUERY]   - Print option: "silkscreen"
[PRICE-QUERY]   - Lead time: "local"
[SEARCH] Searching for: "canvas tote bag"
[SEARCH] Found 4 validated fuzzy match(es) (rejected 0)
[PRICE-QUERY] Product search results (4 found, matchType: fuzzy):
[PRICE-QUERY]   1. A4 Canvas Cream Tote Bag (ID: uuid-1)
[PRICE-QUERY]   2. A4 Canvas Black Tote Bag (ID: uuid-2)
[PRICE-QUERY] Pricing results:
[PRICE-QUERY]   1. Product: "A4 Canvas Cream Tote Bag"
[PRICE-QUERY]      Print: silkscreen print - 1c x 0c | Lead time: local
[PRICE-QUERY]      Quantity: 500 | Unit price: $2.01 | Total: $1005
[PRICE-QUERY]      MOQ: 30 @ $4.42/unit
[PRICE-QUERY] ========== RESPONSE SENT (145ms) ==========
[PRICE-QUERY] Success: true | Products: 1 | Alternatives: 3 | MatchType: fuzzy
```

---

## Future Enhancements (Out of Scope for v1)

- [ ] Price comparison across similar products
- [ ] Bulk discount calculations for very large orders
- [ ] Real-time sync from Google Sheets
- [ ] Price history tracking
- [ ] Multi-currency support

---

## Changelog

### December 2024

**v1.0.0 - Initial Release**
- ✅ Backend API with all 6 endpoints
- ✅ Discord bot with `!price` command
- ✅ Tiered search strategy (Exact → Case-insensitive → Fuzzy)
- ✅ Match validation (50% word overlap requirement)
- ✅ Lead time fallback (local → overseas_air → overseas_sea)
- ✅ Match type tracking in responses
- ✅ Detailed request/response logging
- ✅ Data import from CSV to Supabase
- ✅ Authentication middleware
- ✅ Discord embed formatting

**Bug Fixes**
- Fixed: "t-shirt and hoodie" no longer returns "Canvas Tote Bag" (tiered search)
- Fixed: Overseas-only products now return pricing (lead time fallback)
- Fixed: Logging now shows correct property paths

---

## Related Documents

- `CSV_UPLOAD_GUIDE.md` - Step-by-step guide for uploading pricing data from CSV files
- `DATA_IMPORT_INSTRUCTIONS.md` - CSV parsing rules and format documentation
- `ai-ticket-manager-project-knowledge.md` - Overall system architecture
- Orchestrator PRD (in ai-ticket-manager repo)
