/**
 * One-off importer for the historical "Order Tracking - Sheet9" CSV export.
 *
 * The CSV has NO header and 19 columns (positional). Fields containing commas or
 * newlines are quoted, so we use a proper RFC4180-ish parser (not split(",")).
 *
 * Column map (0-indexed):
 *  0 store         1 shipping     2 orderName(#)  3 date          4 deadline(" 5 PM")
 *  5 item          6 designer     7 uploadStatus  8 fileLink      9 printStatus
 * 10 designerNote 11 machinist   12 machine      13 "View Order" 14 tracking
 * 15 orderStatus  16 ?           17 bool         18 bool(acil?)
 *
 * Note: the export has no Shopify numeric id / order URL (those were hyperlink
 * formulas). We use `import:<STORE>:<orderName>` as a synthetic unique key.
 *
 * Usage: ts-node scripts/importCsv.ts "../Order Tracking - Sheet9 (1).csv"
 */
import fs from "fs";
import path from "path";
import { PrismaClient, OrderStatus } from "@prisma/client";

const prisma = new PrismaClient();

function parseCSV(str: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQ) {
      if (c === '"') {
        if (str[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") {
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const PICKUP_KEYWORDS = ["pick-up", "pickup", "pick up", "store", "cheetahdtf fort worth", "indiana dtf print"];
const isPickup = (shipping: string) => {
  const s = (shipping || "").toLowerCase();
  return PICKUP_KEYWORDS.some((k) => s.includes(k)) || shipping === "Pick-up";
};

function deadlineHourFromLabel(label: string): number {
  const s = (label || "").trim();
  if (s.includes("7")) return 19;
  return 17; // default "5 PM"
}

function mapStatus(v: string): OrderStatus {
  const s = (v || "").trim().toLowerCase();
  if (s === "fulfilled") return "FULFILLED";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  return "NEW";
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

// Historical sheet used Turkish values; normalize them to the app's English values.
const UPLOAD_MAP: Record<string, string> = { "Yüklendi": "Uploaded", "Problemli": "Problem" };
const PRINT_MAP: Record<string, string> = { Basildi: "Printed", Bos: "Not Printed" };
const mapVal = (v: string | null, map: Record<string, string>) => (v ? map[v] ?? v : v);

async function main() {
  const csvArg = process.argv[2];
  if (!csvArg) throw new Error("Pass the CSV path as the first argument");
  const csvPath = path.resolve(process.cwd(), csvArg);
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(text);

  const dist: Record<number, number> = {};
  for (const r of rows) dist[r.length] = (dist[r.length] || 0) + 1;
  console.log("Parsed rows:", rows.length, "| field-count distribution:", JSON.stringify(dist));

  const stores = await prisma.store.findMany();
  const storeByCode = new Map(stores.map((s) => [s.code, s]));

  // Skip any order whose orderName already exists (e.g. arrived via a real webhook),
  // so re-importing the last days doesn't create duplicates.
  const existingRows = await prisma.order.findMany({ select: { orderName: true } });
  const existingNames = new Set(existingRows.map((o) => o.orderName));
  console.log(`Existing orders in DB: ${existingNames.size}`);

  let skippedNoStore = 0;
  let skippedBadOrder = 0;
  let skippedExisting = 0;
  const seen = new Set<string>();
  const records: any[] = [];

  for (const r of rows) {
    if (r.length < 16) { skippedBadOrder++; continue; }
    const storeCode = (r[0] || "").trim().toUpperCase();
    const store = storeByCode.get(storeCode);
    if (!store) { skippedNoStore++; continue; }

    let orderName = (r[2] || "").trim();
    if (!orderName || !orderName.startsWith("#")) { skippedBadOrder++; continue; }

    // Already in the DB (webhook or earlier import) — don't duplicate.
    if (existingNames.has(orderName)) { skippedExisting++; continue; }

    const synthetic = `import:${storeCode}:${orderName}`;
    if (seen.has(synthetic)) continue; // de-dupe within the file (keep first)
    seen.add(synthetic);

    const shipping = (r[1] || "").trim() || "Pick-up";
    const orderDate = new Date((r[3] || "").trim());
    const validDate = !isNaN(orderDate.getTime());
    const baseDate = validDate ? orderDate : new Date();
    const dHour = deadlineHourFromLabel(r[4] || "");
    const deadlineAt = new Date(baseDate);
    deadlineAt.setHours(dHour, 0, 0, 0);

    const itemTypes = (r[5] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const acil = [r[17], r[18]].some((v) => (v || "").trim().toUpperCase() === "TRUE");

    records.push({
      shopifyOrderId: synthetic,
      orderName,
      storeId: store.id,
      storeCode,
      shippingMethod: shipping,
      displayShippingMethod: shipping,
      isPickup: isPickup(shipping),
      orderDate: baseDate,
      deadlineAt,
      deadlineHour: dHour,
      urgent: acil,
      itemTypes,
      orderUrl: "", // no numeric id in the export
      trackingNumber: clean(r[14]),
      status: mapStatus(r[15]),
      designerName: clean(r[6]),
      uploadStatus: mapVal(clean(r[7]), UPLOAD_MAP),
      fileLink: clean(r[8]),
      printStatus: mapVal(clean(r[9]), PRINT_MAP),
      designerNote: clean(r[10]),
      machinistName: clean(r[11]),
      machineName: clean(r[12]),
    });
  }

  console.log(`Prepared ${records.length} records (skipped: existing=${skippedExisting}, no-store=${skippedNoStore}, bad-order=${skippedBadOrder})`);

  // Insert in chunks; skipDuplicates guards against re-runs and unique clashes.
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const res = await prisma.order.createMany({ data: chunk, skipDuplicates: true });
    inserted += res.count;
    process.stdout.write(`\rInserted ${inserted}/${records.length}`);
  }
  console.log(`\nDone. Inserted ${inserted} new orders.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
