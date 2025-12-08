# Price Agent - Product Requirements Document

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

### Project Structure
```
price-agent/
├── discord-bot/               # Discord bot for !price command
│   ├── src/
│   │   ├── index.js           # Bot entry point
│   │   ├── commands/
│   │   │   └── price.js       # !price command handler
│   │   ├── services/
│   │   │   └── priceApi.js    # Calls backend API
│   │   └── utils/
│   │       └── formatters.js  # Discord message formatting
│   ├── package.json
│   └── Dockerfile
│
├── backend/                   # Express API server
│   ├── src/
│   │   ├── server.js          # Express server entry point
│   │   ├── routes/
│   │   │   └── pricing.js     # API route handlers
│   │   ├── services/
│   │   │   ├── supabase.js    # Supabase client
│   │   │   ├── productSearch.js   # Product matching logic
│   │   │   ├── priceQuery.js      # Pricing lookup logic
│   │   │   └── queryParser.js     # Natural language → structured query (Claude)
│   │   └── utils/
│   │       └── formatters.js  # Response formatting
│   ├── package.json
│   └── Dockerfile
│
├── scripts/
│   └── importData.js          # CSV import script
├── data/
│   └── pricing.csv            # Source pricing data
├── .env.example
└── railway.json               # Multi-service Railway config
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

### Endpoint: POST /api/price/query

Primary endpoint for natural language pricing queries from the orchestrator.

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
    "processing_time_ms": 145
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
    "message": "No exact matches found. Did you mean one of these products?"
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

The Price Agent uses Claude to parse natural language queries into structured parameters.

### Claude Prompt Template
```
You are a query parser for a corporate gifts pricing system.

Extract the following from the user's query:
- product: The product name or type (e.g., "canvas tote bag", "tumbler", "notebook")
- quantity: The number of items requested (null if not specified)
- print_option: The printing method if mentioned (e.g., "silkscreen", "heat transfer", "no print")
- lead_time: The delivery preference if mentioned ("local", "overseas", "urgent", "standard")

User Query: "{query}"

Respond in JSON format only:
{
  "product": "...",
  "quantity": null or number,
  "print_option": null or "...",
  "lead_time": null or "..."
}
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

## Product Search Logic

### Search Priority
1. **Exact match** on product_name
2. **Contains match** using ILIKE
3. **Full-text search** using PostgreSQL tsvector
4. **Fuzzy match** using similarity threshold

### SQL Example
```sql
-- Primary search query
SELECT DISTINCT ON (product_name) 
  product_name,
  dimensions,
  category
FROM products
WHERE 
  product_name ILIKE '%' || $1 || '%'
  OR to_tsvector('english', product_name) @@ plainto_tsquery('english', $1)
ORDER BY 
  product_name,
  similarity(product_name, $1) DESC
LIMIT 10;
```

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

### How Orchestrator Calls Price Agent

```javascript
// In orchestrator's price-agent.js

const axios = require('axios');

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

### Discord Bot Implementation

#### Bot Entry Point (discord-bot/src/index.js)

```javascript
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const priceCommand = require('./commands/price');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Command prefix
const PREFIX = '!';

client.once('ready', () => {
  console.log(`Price Agent Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore bots and messages without prefix
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'price') {
    await priceCommand.execute(message, args);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

#### Price Command Handler (discord-bot/src/commands/price.js)

```javascript
const priceApi = require('../services/priceApi');
const { formatPriceResponse, formatErrorResponse } = require('../utils/formatters');

module.exports = {
  name: 'price',
  description: 'Get pricing for corporate gift products',
  
  async execute(message, args) {
    if (!args.length) {
      return message.reply(
        '❌ Please specify a product.\n' +
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
        discordChannelId: message.channel.id
      });
      
      if (response.success) {
        const formattedResponse = formatPriceResponse(response.data);
        await message.reply(formattedResponse);
      } else {
        const errorResponse = formatErrorResponse(response.error);
        await message.reply(errorResponse);
      }
      
    } catch (error) {
      console.error('Price command error:', error);
      await message.reply('❌ Could not fetch pricing. Please try again later.');
    }
  }
};
```

#### Backend API Client (discord-bot/src/services/priceApi.js)

```javascript
const axios = require('axios');

const apiClient = axios.create({
  baseURL: process.env.PRICE_AGENT_BACKEND_URL || 'http://localhost:3001',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.PRICE_AGENT_API_KEY}`
  }
});

module.exports = {
  async query(queryText, context = {}) {
    try {
      const response = await apiClient.post('/api/price/query', {
        query: queryText,
        context: {
          source: 'discord_bot',
          ...context
        }
      });
      return response.data;
    } catch (error) {
      console.error('Price API error:', error.message);
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
  }
};
```

#### Response Formatter (discord-bot/src/utils/formatters.js)

```javascript
const { EmbedBuilder } = require('discord.js');

function formatPriceResponse(data) {
  if (data.products_found === 0) {
    return formatNoResults(data);
  }
  
  if (data.products_found === 1) {
    return formatSingleProduct(data.results[0]);
  }
  
  return formatMultipleProducts(data.results);
}

function formatSingleProduct(result) {
  const embed = new EmbedBuilder()
    .setColor(0x00AA00)
    .setTitle(`📦 ${result.product_name}`)
    .setDescription(`📐 ${result.dimensions || 'N/A'}`)
    .addFields(
      { 
        name: '🖨️ Print Option', 
        value: result.print_option, 
        inline: true 
      },
      { 
        name: '📅 Lead Time', 
        value: result.lead_time.description, 
        inline: true 
      },
      { 
        name: '\u200B', 
        value: '\u200B', 
        inline: true 
      },
      { 
        name: '💰 Price', 
        value: `**${result.pricing.requested_quantity} pcs @ $${result.pricing.unit_price}/pc**\nTotal: **$${result.pricing.total_price.toFixed(2)}**`, 
        inline: false 
      },
      {
        name: '📊 MOQ',
        value: `${result.moq.quantity} pcs @ $${result.moq.unit_price}/pc`,
        inline: true
      }
    );
  
  // Add quantity tiers as a code block for table formatting
  if (result.all_tiers && result.all_tiers.length > 0) {
    const tiersTable = result.all_tiers
      .slice(0, 8) // Limit to 8 tiers to avoid message too long
      .map(tier => {
        const marker = tier.quantity === result.pricing.requested_quantity ? '→' : ' ';
        const moqLabel = tier.quantity === result.moq.quantity ? ' (MOQ)' : '';
        return `${marker} ${tier.quantity}${moqLabel}: $${tier.unit_price}/pc`;
      })
      .join('\n');
    
    embed.addFields({
      name: '📊 Quantity Tiers',
      value: '```\n' + tiersTable + '\n```',
      inline: false
    });
  }
  
  // Add alternatives if available
  if (result.alternatives && result.alternatives.length > 0) {
    const altText = result.alternatives
      .slice(0, 3)
      .map(alt => `• ${alt.print_option} (from $${alt.moq_price})`)
      .join('\n');
    
    embed.addFields({
      name: '🔗 Other Print Options',
      value: altText,
      inline: false
    });
  }
  
  embed.setFooter({ text: 'Prices before GST • EasyPrint' })
    .setTimestamp();
  
  return { embeds: [embed] };
}

function formatMultipleProducts(results) {
  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle(`🔍 Found ${results.length} products`)
    .setDescription('Be more specific for detailed pricing.');
  
  results.slice(0, 5).forEach((result, index) => {
    embed.addFields({
      name: `${index + 1}️⃣ ${result.product_name}`,
      value: `📐 ${result.dimensions || 'N/A'}\nMOQ: ${result.moq.quantity} pcs | Starting: $${result.moq.unit_price}/pc`,
      inline: false
    });
  });
  
  embed.addFields({
    name: '💡 Tip',
    value: 'Try: `!price A4 canvas cream tote 500 silkscreen`',
    inline: false
  });
  
  embed.setFooter({ text: 'Prices before GST • EasyPrint' })
    .setTimestamp();
  
  return { embeds: [embed] };
}

function formatNoResults(data) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('❌ No products found')
    .setDescription(`No matches for your search.`);
  
  if (data.suggestions && data.suggestions.length > 0) {
    embed.addFields({
      name: 'Did you mean?',
      value: data.suggestions.map(s => `• ${s}`).join('\n'),
      inline: false
    });
  }
  
  embed.setFooter({ text: 'Try a different search term' });
  
  return { embeds: [embed] };
}

function formatErrorResponse(error) {
  return `❌ **Error:** ${error.message || 'Something went wrong'}`;
}

module.exports = {
  formatPriceResponse,
  formatSingleProduct,
  formatMultipleProducts,
  formatNoResults,
  formatErrorResponse
};
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

**Phase 1: Database Setup**
- [ ] Create Supabase project (or use existing)
- [ ] Run SQL to create `products` and `pricing` tables
- [ ] Import pricing data from CSV
- [ ] Verify data with test queries

**Phase 2: Backend API**
- [ ] Create Railway project "price-agent"
- [ ] Add service "price-agent-backend" with root `/backend`
- [ ] Set backend environment variables
- [ ] Deploy and verify `/api/health` endpoint
- [ ] Test API with sample queries via curl/Postman

**Phase 3: Discord Bot**
- [ ] Create Discord application at discord.dev
- [ ] Create bot and get token
- [ ] Add bot to EasyPrint Discord server
- [ ] Add service "price-agent-discord-bot" with root `/discord-bot`
- [ ] Set discord-bot environment variables
- [ ] Set `PRICE_AGENT_BACKEND_URL` to Railway backend URL
- [ ] Deploy and verify bot comes online
- [ ] Test `!price` command in Discord

**Phase 4: Integration**
- [ ] Update Ticket Manager orchestrator with Price Agent backend URL
- [ ] Test `!ticket` command with pricing questions
- [ ] Verify both access methods work

---

## Testing

### Backend API Test Queries

| Query | Expected Result |
|-------|-----------------|
| "How much for 100 canvas tote bags?" | Returns A4/A3 Canvas Tote Bag options with prices at qty 100 |
| "MOQ for tote bags with silkscreen print" | Returns MOQ of 30 with price $4.42 |
| "Price list for A4 Canvas Cream Tote Bag" | Returns all print options and tiers |
| "500 black tote bags 2 color print" | Returns A4 Canvas Black Tote Bag, silkscreen 2c x 0c, $2.73/pc |
| "cheapest tote bag option" | Returns No Print option with lowest price tier |

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

## Future Enhancements (Out of Scope for v1)

- [ ] Price comparison across similar products
- [ ] Bulk discount calculations for very large orders
- [ ] Real-time sync from Google Sheets
- [ ] Price history tracking
- [ ] Multi-currency support

---

## Related Documents

- `DATA_IMPORT_INSTRUCTIONS.md` - CSV parsing rules for initial data import
- `ai-ticket-manager-project-knowledge.md` - Overall system architecture
- Orchestrator PRD (in ai-ticket-manager repo)
