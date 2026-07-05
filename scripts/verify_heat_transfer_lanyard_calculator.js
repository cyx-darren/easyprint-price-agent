#!/usr/bin/env node
"use strict";

// Read-only sanity check for the heat transfer lanyard price calculator.
//
// Downloads the "Heat Transfer Lanyards" 1.5cm/2cm/2.5cm tabs from the master
// pricing workbook as CSV, extracts every published selling price, and
// compares each one against the Supabase `heat_transfer_lanyard_prices` view.
// Run this after any change to lanyard_* cost tables or
// global_overseas_pricing to confirm the calculator still reproduces the
// workbook.
//
// Usage: node scripts/verify_heat_transfer_lanyard_calculator.js [--env backend/.env]

const fs = require("fs");
const path = require("path");

const DEFAULT_ENV = "backend/.env";
const SHEET_ID = "1Tsg-TtoMeueTOWlDWUoPswlmoVWmlAsO9lFsZOUDruY";
const TABS = [
  { widthMm: 15, gid: "395981195", name: "1.5cm" },
  { widthMm: 20, gid: "1789168375", name: "2cm" },
  { widthMm: 25, gid: "939596929", name: "2.5cm" },
];

const AIR_LABEL = "Using Air Freight";
const SEA_LABEL = "Using Sea Freight";

// Blocks at these 0-indexed CSV rows carry inconsistent labels on some tabs
// (mislabels or reversed word order); their formulas reference these
// canonical component tables. Block positions are identical across all three
// tabs, so the overrides apply universally.
const BLOCK_LABEL_OVERRIDES = new Map([
  [75, "lobster claw + retractable reel (no print)"],
  [81, "lobster claw + retractable reel (logo print)"],
  [189, "retractable reel (logo print) + buckle clip"],
]);

// Accepted deviations where the calculator's uniform formula differs from a
// single inconsistent sheet tab (user decisions; reported as warnings):
//   1. The 1.5cm tab's nine "retractable reel (logo print)" blocks omit the
//      reel print fee from the air-freight import-GST term (their own sea
//      rows and the other tabs include it) -> calculator slightly higher.
//   2. The 2cm tab's two "lobster claw + retractable reel" blocks keep the
//      mold fee at 3,000+ pcs (the other tabs waive it) -> calculator
//      slightly lower.
function isKnownDeviation(point) {
  if (
    point.widthMm === 15 &&
    point.attachment.includes("retractable reel (logo print)") &&
    point.freightType === "air"
  ) {
    return true;
  }
  return (
    point.widthMm === 20 &&
    point.attachment.startsWith("lobster claw + retractable reel") &&
    point.quantity >= 3000
  );
}

function loadEnv(envPath) {
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !(match[1] in process.env)) {
        env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return env;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Map a workbook block label to the canonical lanyard_component_costs
// attachment_type value.
function normalizeAttachment(raw) {
  let name = raw.toLowerCase().trim();
  name = name.replace(/,\s*(double\s+)?black lobster claw \(thin\)/g, "");
  name = name.replace(/\+\s*15\s*usd/g, "");
  name = name.replace(/,/g, " + ");
  const parts = name
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(" + ");
}

function extractSheetPrices(rows, widthMm) {
  const points = [];
  const blocks = [];
  for (let i = 0; i < rows.length; i += 1) {
    const cell = (rows[i][0] || "").trim();
    if (!cell.endsWith("x 90cm")) continue;
    const label = BLOCK_LABEL_OVERRIDES.get(i) || (rows[i][1] || "").trim();
    const attachment = normalizeAttachment(label);
    const qtyRow = rows[i + 1] || [];
    if ((qtyRow[0] || "").trim() !== "Qty") {
      throw new Error(`Block at CSV row ${i} has no Qty header row`);
    }
    blocks.push(attachment);
    for (let j = i + 2; j < rows.length; j += 1) {
      const rowLabel = (rows[j][0] || "").trim();
      let freightType = null;
      if (rowLabel.startsWith(AIR_LABEL)) freightType = "air";
      else if (rowLabel.startsWith(SEA_LABEL)) freightType = "sea";
      else break;
      for (let col = 1; col < rows[j].length; col += 1) {
        const priceText = (rows[j][col] || "").trim();
        const qtyText = (qtyRow[col] || "").trim();
        if (!priceText || !qtyText) continue;
        points.push({
          widthMm,
          attachment,
          freightType,
          quantity: parseInt(qtyText, 10),
          sheetPrice: parseFloat(priceText),
          decimals: (priceText.split(".")[1] || "").length,
        });
      }
    }
  }
  return { points, blocks };
}

async function fetchViewPrices(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required (backend/.env or environment)");
  }
  const prices = new Map();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      `${url}/rest/v1/heat_transfer_lanyard_prices?select=attachment_type,width_mm,freight_type,quantity,unit_price_sgd`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Supabase view fetch failed: ${response.status} ${await response.text()}`);
    }
    const page = await response.json();
    for (const row of page) {
      prices.set(
        `${row.attachment_type}|${row.width_mm}|${row.freight_type}|${row.quantity}`,
        parseFloat(row.unit_price_sgd)
      );
    }
    if (page.length < pageSize) break;
  }
  return prices;
}

async function main() {
  const envFlagIndex = process.argv.indexOf("--env");
  const envPath = envFlagIndex >= 0 ? process.argv[envFlagIndex + 1] : DEFAULT_ENV;
  const env = loadEnv(path.resolve(__dirname, "..", envPath));

  const points = [];
  for (const tab of TABS) {
    console.log(`Downloading ${tab.name} tab (gid=${tab.gid}) ...`);
    const csvResponse = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${tab.gid}`
    );
    if (!csvResponse.ok) {
      throw new Error(`Sheet CSV download failed for ${tab.name}: ${csvResponse.status}`);
    }
    const extracted = extractSheetPrices(parseCsv(await csvResponse.text()), tab.widthMm);
    console.log(`  ${tab.name}: ${extracted.blocks.length} blocks, ${extracted.points.length} price points`);
    points.push(...extracted.points);
  }

  console.log("Fetching heat_transfer_lanyard_prices view ...");
  const viewPrices = await fetchViewPrices(env);
  console.log(`View rows: ${viewPrices.size}`);

  const mismatches = [];
  const knownDeviations = [];
  let missing = 0;
  for (const point of points) {
    const key = `${point.attachment}|${point.widthMm}|${point.freightType}|${point.quantity}`;
    const viewPrice = viewPrices.get(key);
    if (viewPrice === undefined) {
      missing += 1;
      mismatches.push({ ...point, viewPrice: null, reason: "missing from view" });
      continue;
    }
    // The CSV export shows display-rounded values, so allow half a unit of
    // the sheet's last printed decimal place.
    const tolerance = 0.5 * 10 ** -point.decimals + 1e-9;
    if (Math.abs(viewPrice - point.sheetPrice) > tolerance) {
      if (isKnownDeviation(point)) {
        knownDeviations.push({ ...point, viewPrice });
      } else {
        mismatches.push({ ...point, viewPrice, reason: "value mismatch" });
      }
    }
  }

  if (knownDeviations.length > 0) {
    console.warn(
      `Known deviations (uniform formula vs inconsistent sheet cells: 1.5cm logo-print air rows, 2cm lobster claw + reel 3000+ rows): ${knownDeviations.length}`
    );
  }
  if (mismatches.length === 0) {
    console.log(`OK: all ${points.length} sheet prices match the view` +
      (knownDeviations.length > 0 ? ` (excluding ${knownDeviations.length} known deviations).` : "."));
    return;
  }
  console.error(`FAILED: ${mismatches.length} mismatches (${missing} missing from view).`);
  for (const m of mismatches.slice(0, 25)) {
    console.error(
      `  ${m.widthMm}mm | ${m.attachment} | ${m.freightType} | qty ${m.quantity}: sheet=${m.sheetPrice} view=${m.viewPrice} (${m.reason})`
    );
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
