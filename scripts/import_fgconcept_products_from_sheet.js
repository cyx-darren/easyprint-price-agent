#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const VENDOR = "FGCONCEPT";
const DEFAULT_SHEET_ID = "10tsMLZTUNoaB_dYYfhDfLMhLYQkoPjG_yAoVJ_soXBA";
const DEFAULT_SHEET_GID = "485920976";
const DEFAULT_DEVTOOLS_URL = process.env.CHROME_DEVTOOLS_URL || "http://127.0.0.1:9333";
const DEFAULT_ENV = "backend/.env";
const EXPECTED_HEADERS = ["Item Code", "Product Descriptions", "Dealers", "Balance", "IN", "OUT", "Balance"];

function usage() {
  console.log(`Usage: node scripts/import_fgconcept_products_from_sheet.js [options]

Import the approved FGCONCEPT Google Sheet into fgconcept_products,
fgconcept_product_snapshots, and fgconcept_product_scrape_runs.

Defaults to dry-run. Pass --commit to write to Supabase.

Options:
  --devtools-url URL       Chrome DevTools URL. Default: ${DEFAULT_DEVTOOLS_URL}
  --sheet-id ID            Google Sheet ID. Default: ${DEFAULT_SHEET_ID}
  --sheet-gid GID          Google Sheet tab gid. Default: ${DEFAULT_SHEET_GID}
  --env PATH               Env file with Supabase credentials. Default: ${DEFAULT_ENV}
  --limit-rows N           Parse only the first N data rows after the header.
  --commit                 Insert snapshots and upsert latest products to Supabase.
  --rpc-token TOKEN        Use a token-protected import RPC instead of direct table writes.
  --allow-non-service-key  Allow --commit without a service_role JWT.
  --json                   Print summary as JSON.
  --help                   Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    devtoolsUrl: DEFAULT_DEVTOOLS_URL,
    sheetId: DEFAULT_SHEET_ID,
    sheetGid: DEFAULT_SHEET_GID,
    envPath: DEFAULT_ENV,
    limitRows: null,
    commit: false,
    rpcToken: process.env.FGCONCEPT_IMPORT_RPC_TOKEN || null,
    allowNonServiceKey: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg === "--devtools-url") {
      options.devtoolsUrl = next().replace(/\/$/, "");
    } else if (arg === "--sheet-id") {
      options.sheetId = next();
    } else if (arg === "--sheet-gid") {
      options.sheetGid = next();
    } else if (arg === "--env") {
      options.envPath = next();
    } else if (arg === "--limit-rows") {
      options.limitRows = Number.parseInt(next(), 10);
      if (!Number.isInteger(options.limitRows) || options.limitRows <= 0) {
        throw new Error("--limit-rows must be a positive integer");
      }
    } else if (arg === "--commit") {
      options.commit = true;
    } else if (arg === "--rpc-token") {
      options.rpcToken = next();
    } else if (arg === "--allow-non-service-key") {
      options.allowNonServiceKey = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function loadEnvFile(envPath) {
  const resolved = path.resolve(envPath);
  if (!fs.existsSync(resolved)) return {};

  const values = {};
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }
  return values;
}

function jwtRole(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload).role || null;
  } catch (_error) {
    return null;
  }
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parsePrice(value) {
  const cleaned = normalizeSpace(value).replace(/[$,]/g, "");
  if (!cleaned) return null;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]).toFixed(2) : null;
}

function parseBalanceValue(value) {
  const cleaned = normalizeSpace(value).replace(/,/g, "");
  if (!cleaned) return null;
  return /^\d+$/.test(cleaned) ? Number.parseInt(cleaned, 10) : null;
}

function selectBalance(row) {
  for (const columnIndex of [6, 3, 7]) {
    const balance = parseBalanceValue(row[columnIndex]);
    if (balance !== null) return balance;
  }
  return null;
}

function slugify(value) {
  const slug = normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "default";
}

function variantKey(productDescription, variantDescription) {
  const source = normalizeSpace(variantDescription || productDescription || "default").toLowerCase();
  return source.slice(0, 300);
}

function validateHeaders(rows) {
  if (!rows.length) throw new Error("Sheet CSV is empty");
  const actual = rows[0].slice(0, EXPECTED_HEADERS.length).map(normalizeSpace);
  const mismatch = EXPECTED_HEADERS.some((header, index) => actual[index] !== header);
  if (mismatch) {
    throw new Error(`Unexpected first columns. Expected ${JSON.stringify(EXPECTED_HEADERS)}, got ${JSON.stringify(actual)}`);
  }
}

function parseStockRows(csvRows, { sheetId, sheetGid, limitRows }) {
  validateHeaders(csvRows);

  const dataRows = limitRows ? csvRows.slice(1, limitRows + 1) : csvRows.slice(1);
  const stockRows = [];
  let currentProduct = null;
  let pendingVariantDescription = null;

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const sourceRowNumber = index + 2;
    const itemCode = normalizeSpace(row[0]);
    const description = normalizeSpace(row[1]);
    const dealerPriceText = normalizeSpace(row[2]);
    const balance = selectBalance(row);

    if (itemCode) {
      currentProduct = {
        itemCode,
        productDescription: description || null,
        dealerPrice: parsePrice(dealerPriceText),
      };
      pendingVariantDescription = null;
    }

    if (!currentProduct) continue;
    if (balance === null) {
      if (!itemCode && description) pendingVariantDescription = description;
      continue;
    }

    const rowDealerPrice = parsePrice(dealerPriceText);
    const variantDescription = itemCode ? null : description || pendingVariantDescription || null;
    if (!itemCode && !variantDescription) continue;

    stockRows.push({
      original_item_code: currentProduct.itemCode,
      variant_key: variantKey(currentProduct.productDescription, variantDescription),
      product_description: currentProduct.productDescription,
      variant_description: variantDescription,
      dealer_price: rowDealerPrice || currentProduct.dealerPrice,
      stock_balance: balance,
      source_row_number: sourceRowNumber,
      source_sheet_id: sheetId,
      source_sheet_gid: sheetGid,
      raw_row: {
        item_code: itemCode,
        product_description: description,
        dealer_price: dealerPriceText,
        balance_d: normalizeSpace(row[3]),
        in: normalizeSpace(row[4]),
        out: normalizeSpace(row[5]),
        balance_g: normalizeSpace(row[6]),
        balance_h: normalizeSpace(row[7]),
      },
    });
    pendingVariantDescription = null;
  }

  disambiguateDuplicateVariantKeys(stockRows);
  return stockRows;
}

function disambiguateDuplicateVariantKeys(stockRows) {
  const counts = new Map();
  for (const row of stockRows) {
    const key = `${row.original_item_code}\x1f${row.variant_key}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const row of stockRows) {
    const key = `${row.original_item_code}\x1f${row.variant_key}`;
    if (counts.get(key) <= 1) continue;
    row.raw_row.variant_key_disambiguated_from = row.variant_key;
    row.variant_key = `${row.variant_key} #row-${row.source_row_number}`;
  }
}

function toProductRow(row) {
  const variantSlug = slugify(row.variant_key);
  const itemCode = `${row.original_item_code}::${variantSlug}`;
  const description = row.variant_description
    ? `${row.product_description || row.original_item_code} - ${row.variant_description}`
    : row.product_description || row.original_item_code;

  return {
    vendor: VENDOR,
    series_code: row.original_item_code,
    item_code: itemCode,
    item_unit_price: row.dealer_price,
    currency: "SGD",
    description,
    image_url: null,
    stock_status: String(row.stock_balance),
    stock_quantity: row.stock_balance,
    decoration_methods: [],
    raw_product: {
      source: "fgconcept_google_sheet_csv",
      original_item_code: row.original_item_code,
      variant_key: row.variant_key,
      product_description: row.product_description,
      variant_description: row.variant_description,
      dealer_price: row.dealer_price,
      stock_balance: row.stock_balance,
      source_row_number: row.source_row_number,
      source_sheet_id: row.source_sheet_id,
      source_sheet_gid: row.source_sheet_gid,
      raw_row: row.raw_row,
    },
  };
}

function validateUniqueProductCodes(products) {
  const counts = new Map();
  for (const product of products) {
    const key = `${product.vendor}\x1f${product.item_code}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicates = Array.from(counts.entries()).filter((entry) => entry[1] > 1);
  if (duplicates.length) {
    const examples = duplicates.slice(0, 10).map(([key, count]) => {
      const [_vendor, itemCode] = key.split("\x1f");
      return `${itemCode} (${count} rows)`;
    });
    throw new Error(`Duplicate synthetic FGCONCEPT item codes found: ${examples.join("; ")}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

async function findSheetTab(devtoolsUrl, sheetId) {
  const tabs = await fetchJson(`${devtoolsUrl.replace(/\/$/, "")}/json/list`);
  const tab = tabs.find((entry) => (
    entry.type === "page"
    && entry.url
    && entry.url.includes(`/spreadsheets/d/${sheetId}`)
    && entry.webSocketDebuggerUrl
  ));
  if (!tab) {
    throw new Error(`No authenticated Google Sheet tab for ${sheetId} found at ${devtoolsUrl}.`);
  }
  return tab;
}

async function evaluateInTab(webSocketDebuggerUrl, expression) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = (commandId += 1);
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  try {
    await send("Runtime.enable");
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.result.exceptionDetails) {
      throw new Error(`Page evaluation failed: ${JSON.stringify(response.result.exceptionDetails)}`);
    }
    return response.result.result.value;
  } finally {
    ws.close();
  }
}

async function fetchSheetCsvViaChrome(options) {
  const tab = await findSheetTab(options.devtoolsUrl, options.sheetId);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${options.sheetId}/gviz/tq?tqx=out:csv&gid=${options.sheetGid}`;
  const result = await evaluateInTab(
    tab.webSocketDebuggerUrl,
    `(async () => {
      const response = await fetch(${JSON.stringify(csvUrl)}, { credentials: "include" });
      const text = await response.text();
      return {
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        text
      };
    })()`,
  );

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Sheet CSV fetch failed with HTTP ${result.status}: ${String(result.text || "").slice(0, 300)}`);
  }
  if (!String(result.contentType).includes("text/csv")) {
    throw new Error(`Sheet CSV fetch returned ${result.contentType || "unknown content type"} instead of text/csv.`);
  }
  return result.text;
}

function sourceSheetUrl(options) {
  return `https://docs.google.com/spreadsheets/d/${options.sheetId}/edit?gid=${options.sheetGid}`;
}

async function requestSupabaseJson({ method, url, key, payload, prefer = "return=representation" }) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${method} ${url} failed: HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return body ? JSON.parse(body) : null;
}

function chunked(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function postgrestInFilter(values) {
  return encodeURIComponent(`(${values.map((value) => JSON.stringify(value)).join(",")})`);
}

class SupabaseImporter {
  constructor({ supabaseUrl, serviceKey }) {
    this.supabaseUrl = supabaseUrl.replace(/\/$/, "");
    this.serviceKey = serviceKey;
  }

  async createRun(options, products, metadata) {
    const uniqueSeries = new Set(products.map((product) => product.series_code));
    const rows = await requestSupabaseJson({
      method: "POST",
      url: `${this.supabaseUrl}/rest/v1/fgconcept_product_scrape_runs`,
      key: this.serviceKey,
      payload: {
        vendor: VENDOR,
        source_url: sourceSheetUrl(options),
        run_type: options.limitRows ? "partial" : "full",
        status: "started",
        series_count: uniqueSeries.size,
        metadata,
      },
    });
    return rows[0].id;
  }

  async insertSnapshots(runId, products, scrapedAt) {
    const rows = products.map((product) => ({
      ...product,
      scrape_run_id: runId,
      scraped_at: scrapedAt,
    }));
    for (const batch of chunked(rows, 500)) {
      await requestSupabaseJson({
        method: "POST",
        url: `${this.supabaseUrl}/rest/v1/fgconcept_product_snapshots`,
        key: this.serviceKey,
        payload: batch,
        prefer: "return=minimal",
      });
    }
  }

  async upsertProducts(products, scrapedAt) {
    const rows = products.map((product) => ({
      ...product,
      is_active: true,
      last_seen_at: scrapedAt,
      last_scraped_at: scrapedAt,
      missing_since_at: null,
      updated_at: scrapedAt,
    }));
    const columns = [
      "vendor",
      "series_code",
      "item_code",
      "item_unit_price",
      "currency",
      "description",
      "image_url",
      "stock_status",
      "stock_quantity",
      "decoration_methods",
      "raw_product",
      "is_active",
      "last_seen_at",
      "last_scraped_at",
      "missing_since_at",
      "updated_at",
    ].join(",");

    for (const batch of chunked(rows, 500)) {
      await requestSupabaseJson({
        method: "POST",
        url: `${this.supabaseUrl}/rest/v1/fgconcept_products?on_conflict=vendor,item_code&columns=${columns}`,
        key: this.serviceKey,
        payload: batch,
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    }
  }

  async markMissingInactive(seenItemCodes, scrapedAt) {
    const rows = await requestSupabaseJson({
      method: "GET",
      url: `${this.supabaseUrl}/rest/v1/fgconcept_products?select=id,item_code&vendor=eq.${encodeURIComponent(VENDOR)}&is_active=eq.true&limit=10000`,
      key: this.serviceKey,
    });
    const missingIds = rows
      .filter((row) => !seenItemCodes.has(row.item_code))
      .map((row) => row.id);

    for (const batch of chunked(missingIds, 300)) {
      await requestSupabaseJson({
        method: "PATCH",
        url: `${this.supabaseUrl}/rest/v1/fgconcept_products?id=in.${postgrestInFilter(batch)}`,
        key: this.serviceKey,
        payload: {
          is_active: false,
          missing_since_at: scrapedAt,
          last_scraped_at: scrapedAt,
          updated_at: scrapedAt,
        },
        prefer: "return=minimal",
      });
    }
    return missingIds.length;
  }

  async completeRun(runId, payload) {
    await requestSupabaseJson({
      method: "PATCH",
      url: `${this.supabaseUrl}/rest/v1/fgconcept_product_scrape_runs?id=eq.${runId}`,
      key: this.serviceKey,
      payload,
      prefer: "return=minimal",
    });
  }
}

async function importViaRpc({ supabaseUrl, key, rpcToken, options, csvRows, products, metadata }) {
  const response = await requestSupabaseJson({
    method: "POST",
    url: `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/_import_fgconcept_products_from_sheet`,
    key,
    payload: {
      p_token: rpcToken,
      p_source_sheet_url: sourceSheetUrl(options),
      p_source_sheet_gid: options.sheetGid,
      p_source_row_count: csvRows.length,
      p_product_count: products.length,
      p_series_count: new Set(products.map((product) => product.series_code)).size,
      p_run_type: options.limitRows ? "partial" : "full",
      p_metadata: metadata,
      p_rows: products,
    },
  });
  return response;
}

function printSummary(summary, asJson) {
  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("");
  console.log("FGCONCEPT product import summary");
  console.log(`  mode: ${summary.committed ? "commit" : "dry-run"}`);
  console.log(`  source rows: ${summary.sourceRows}`);
  console.log(`  parsed product rows: ${summary.parsedProductRows}`);
  console.log(`  unique original item codes: ${summary.uniqueOriginalItemCodes}`);
  console.log(`  sheet: ${summary.sheetUrl}`);
  if (summary.importRunId) console.log(`  scrape run: ${summary.importRunId}`);
  if (summary.inactiveMarkedCount) console.log(`  marked inactive: ${summary.inactiveMarkedCount}`);
  for (const row of summary.sampleRows) {
    console.log(
      "  sample:",
      row.series_code,
      row.item_code,
      row.item_unit_price || "",
      row.stock_quantity,
      row.description || "",
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = { ...loadEnvFile(options.envPath), ...process.env };
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY;

  if (options.commit && (!supabaseUrl || !serviceKey)) {
    throw new Error(`SUPABASE_URL and SUPABASE_SERVICE_KEY are required in ${options.envPath} or environment for --commit.`);
  }
  if (options.commit && !options.rpcToken && jwtRole(serviceKey) !== "service_role" && !options.allowNonServiceKey) {
    throw new Error(
      "SUPABASE_SERVICE_KEY is not a service_role JWT. Refusing --commit. "
      + "Use a real service-role key, pass --rpc-token for the approved import RPC, "
      + "or pass --allow-non-service-key only during a controlled maintenance window.",
    );
  }

  const csv = await fetchSheetCsvViaChrome(options);
  const csvRows = parseCsv(csv);
  const stockRows = parseStockRows(csvRows, options);
  const products = stockRows.map(toProductRow);
  validateUniqueProductCodes(products);

  const scrapedAt = new Date().toISOString();
  const uniqueOriginalItemCodes = new Set(products.map((product) => product.series_code));
  const metadata = {
    devtools_url: options.devtoolsUrl,
    limit_rows: options.limitRows,
    source_rows: csvRows.length,
    parsed_product_rows: products.length,
    unique_original_item_codes: uniqueOriginalItemCodes.size,
    synthetic_item_code_strategy: "original_item_code::slugified_variant_key",
  };
  const summary = {
    committed: options.commit,
    sourceRows: csvRows.length,
    parsedProductRows: products.length,
    uniqueOriginalItemCodes: uniqueOriginalItemCodes.size,
    sheetUrl: sourceSheetUrl(options),
    sampleRows: products.slice(0, 10),
  };

  if (!options.commit) {
    printSummary(summary, options.json);
    return;
  }

  if (options.rpcToken) {
    const result = await importViaRpc({
      supabaseUrl,
      key: serviceKey,
      rpcToken: options.rpcToken,
      options,
      csvRows,
      products,
      metadata,
    });
    summary.importRunId = result.import_run_id;
    summary.inactiveMarkedCount = result.inactive_marked_count || 0;
    printSummary(summary, options.json);
    return;
  }

  const importer = new SupabaseImporter({ supabaseUrl, serviceKey });
  const runId = await importer.createRun(options, products, metadata);
  summary.importRunId = runId;

  try {
    await importer.insertSnapshots(runId, products, scrapedAt);
    await importer.upsertProducts(products, scrapedAt);
    let inactiveMarkedCount = 0;
    if (!options.limitRows) {
      inactiveMarkedCount = await importer.markMissingInactive(new Set(products.map((product) => product.item_code)), scrapedAt);
    }
    summary.inactiveMarkedCount = inactiveMarkedCount;
    await importer.completeRun(runId, {
      status: "succeeded",
      completed_at: new Date().toISOString(),
      succeeded_series_count: uniqueOriginalItemCodes.size,
      failed_series_count: 0,
      product_count: products.length,
      failed_series: [],
      error_message: null,
      metadata: { ...metadata, inactive_marked_count: inactiveMarkedCount },
    });
    printSummary(summary, options.json);
  } catch (error) {
    await importer.completeRun(runId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      succeeded_series_count: 0,
      failed_series_count: uniqueOriginalItemCodes.size,
      product_count: 0,
      failed_series: Array.from(uniqueOriginalItemCodes),
      error_message: error.message,
      metadata,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
