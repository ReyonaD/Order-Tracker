// Fill July 2026 Sheets: combine the Shopify 1-19 sales CSVs (per store) with
// Order Tracker's own 7/20-7/31 orders, using the same category classification,
// and write the totals as SheetEntry.totalOverride for 2026-07.
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

const prisma = new PrismaClient();
const CSV_DIR = "C:/Users/Alp_office/Documents/temmuz1-19";
const MONTH = "2026-07";
const zone = "America/Chicago";

// ---- category classification (mirror of backend sheetCategories.ts) ----
const IGNORE = /\btip\b|gratuity|\bfee\b|rush|expedit|\bpriority\b|handling|processing|\bdeposit\b|donation|discount|insurance/;
const RULES = [
  ["Sublimation", "inches", /sublima/],
  ["Cleaning Solution", "count", /cleaning/],
  ["Vinyl Remover", "count", /vinyl/],
  ["Heat Tape", "count", /heat\s*tape/],
  ["Teflon", "count", /teflon/],
  ["DTF Ink", "count", /\bink\b/],
  ["Powder", "count", /powder/],
  ["DTF Film", "count", /\bfilm\b/],
  ["Damper", "count", /damper/],
  ["Data Cable", "count", /data\s*cable/],
  ["Capping Station", "count", /capping/],
  ["Encoder Strip", "count", /encoder/],
  ["Origin Sensor", "count", /origin\s*sensor/],
  ["Leather Journal", "count", /leather\s*journal|journal/],
  ["UV", "inches", /\buv\b/],
  ["Sweatshirt", "count", /sweat\s*shirt|hoodie|hooded|crew\s*neck/],
  ["Custom Shirt", "count", /t-?shirt|\btee\b|tshirt|custom shirt|bella|canvas|gildan|comfort colors|apparel/],
  ["DTF", "inches", /transfer|gang sheet|\bdtf\b/],
];
function categoryOf(name, title) {
  const text = `${name || ""} ${title || ""}`.toLowerCase();
  if (!text.trim()) return null;
  if (IGNORE.test(text)) return null;
  for (const [key, kind, re] of RULES) if (re.test(text)) return { key, kind };
  const label = (title || name || "").trim();
  return label ? { key: label, kind: "count" } : null;
}
function itemLength(variant, name, title) {
  for (const s of [variant, name, title]) {
    if (!s) continue;
    const m = s.match(/(\d+)\s*(?:in\b|")?\s*[xX]\s*"?\s*(\d+)/);
    if (m) return Number(m[2]);
  }
  return 0;
}

function parseLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if (ch === ",") { out.push(cur); cur = ""; } else if (ch === '"') q = true; else cur += ch; }
  }
  out.push(cur);
  return out;
}
function storeOf(fn) {
  fn = fn.toLowerCase();
  if (fn.includes("boston")) return "BOSTONIAN";
  if (fn.includes("cheetah")) return "CHEETAH";
  if (fn.includes("gangroll")) return "GANGROLL";
  if (fn.includes("indiana")) return "INDIANA";
  if (fn.includes("louisville")) return "LUISVILLE";
  if (fn.includes("missouri")) return "MISSOURI";
  if (fn.includes("music")) return "MUSICCITY";
  if (fn.includes("picasso")) return "PICASSO";
  if (fn.includes("promo")) return "PROMO";
  if (fn.includes("west")) return "WESTCOAST";
  return null;
}

// csv[store][catKey] = value (Shopify 1-19); otEarly[store][catKey] = OT 1-19
const csv = {};
const otEarly = {};
function addTo(obj, store, key, v) { (obj[store] ||= {}); obj[store][key] = (obj[store][key] || 0) + v; }
const add = (store, key, v) => addTo(csv, store, key, v);

// ---- 1) Shopify 1-19 CSVs ----
for (const fn of fs.readdirSync(CSV_DIR)) {
  if (!fn.toLowerCase().endsWith(".csv")) continue;
  const store = storeOf(fn);
  if (!store) { console.log("skip (no store):", fn); continue; }
  const lines = fs.readFileSync(path.join(CSV_DIR, fn), "utf8").split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseLine(lines[i]);
    const title = f[0], variant = f[1], units = Number(f[3]) || 0;
    if (!units) continue;
    const name = `${title} ${variant}`;
    const cat = categoryOf(name, title);
    if (!cat) continue;
    const val = cat.kind === "inches" ? itemLength(variant, name, title) * units : units;
    if (val) add(store, cat.key, val);
  }
}

// ---- 2) Order Tracker's OWN 7/1 - 7/19 (to subtract the overlap) ----
const start = DateTime.fromISO("2026-07-01", { zone }).startOf("day");
const end = DateTime.fromISO("2026-07-20", { zone }).startOf("day"); // < 7/20 => 1..19
const orders = await prisma.order.findMany({
  where: { orderDate: { gte: start.toJSDate(), lt: end.toJSDate() }, status: { not: "CANCELLED" } },
  select: { storeCode: true, lineItems: true },
});
for (const o of orders) {
  const arr = Array.isArray(o.lineItems) ? o.lineItems : [];
  for (const li of arr) {
    const cat = categoryOf(`${li.name || ""} ${li.title || ""}`, li.title || li.name);
    if (!cat) continue;
    const qty = li.quantity ?? 1;
    const val = cat.kind === "inches" ? itemLength(li.variant_title, li.name, li.title) * qty : qty;
    if (val) addTo(otEarly, o.storeCode, cat.key, val);
  }
}

// ---- 3) baseline = CSV(1-19) - OT(1-19); live auto adds 20-31 on top ----
const round = (n) => Math.round(n * 10) / 10;
// clear any previously-written July totalOverride so nothing stays frozen
if (!process.env.DRY) await prisma.sheetEntry.updateMany({ where: { month: MONTH }, data: { totalOverride: null } });
let n = 0;
for (const [store, cats] of Object.entries(csv)) {
  for (const [key, v] of Object.entries(cats)) {
    const baseline = round(Math.max(0, v - (otEarly[store]?.[key] || 0)));
    if (baseline <= 0) continue;
    if (process.env.DRY) { console.log(`${store.padEnd(10)} ${key.padEnd(16)} csv=${round(v)} otEarly=${round(otEarly[store]?.[key] || 0)} baseline=${baseline}`); n++; continue; }
    await prisma.sheetEntry.upsert({
      where: { month_storeCode_type: { month: MONTH, storeCode: store, type: key } },
      create: { month: MONTH, storeCode: store, type: key, baseline },
      update: { baseline, totalOverride: null },
    });
    n++;
  }
}
console.log(`July baseline fill: ${n} category rows ${process.env.DRY ? "(dry)" : "written"}`);
await prisma.$disconnect();
