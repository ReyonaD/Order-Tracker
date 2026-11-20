// Embroidery orders from ShipStation (API v1). Every few minutes: fetch the orders
// modified since the last run, keep those with an "Embroidered/Embroidery" item.
// ShipStation dates have no offset and are Pacific time.
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";

const SS_BASE = "https://ssapi.shipstation.com";
const SS_TZ = "America/Los_Angeles";
// an item is embroidery when its listing title says so, or its SKU carries the EMB tag
// (the same listing can have an "Applique…" title in one shop and "…Embroidered…" in another)
const EMB_RE = /embroider/i;
const EMB_SKU_RE = /\bEMB\b/;
const isEmb = (i: SsItem) => EMB_RE.test(i.name ?? "") || EMB_SKU_RE.test(i.sku ?? "");
const CURSOR_KEY = "ss_modify_since";
const BACKFILL_DAYS = 30;
const OVERLAP_MIN = 10;

export const ssConfigured = () => !!(process.env.SS_API_KEY && process.env.SS_API_SECRET);

async function ssGet<T>(path: string): Promise<T> {
  const auth = Buffer.from(`${process.env.SS_API_KEY}:${process.env.SS_API_SECRET}`).toString("base64");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SS_BASE}${path}`, { headers: { Authorization: `Basic ${auth}` } });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("x-rate-limit-reset") || 30);
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`ShipStation ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
}

interface SsItem { name: string | null; sku: string | null; quantity: number; imageUrl: string | null; options: { name: string; value: string }[] | null }
interface SsOrder {
  orderId: number; orderNumber: string; orderDate: string; paymentDate: string | null; shipByDate: string | null;
  modifyDate: string; orderStatus: string; shipDate: string | null; shipTo: { name: string | null } | null;
  items: SsItem[]; advancedOptions: { storeId: number | null } | null;
}

const ssDate = (s: string | null | undefined) => {
  if (!s) return null;
  const d = DateTime.fromISO(s, { zone: SS_TZ });
  return d.isValid ? d.toJSDate() : null;
};

/** The sheet's product names, from an embroidered item's title. */
export function productType(name: string): string {
  const n = name.toLowerCase();
  if (/\bpolo\b/.test(n)) return "SHIRT-POLO";
  if (/hoodie/.test(n)) return "HOODIE";
  if (/sweatshirt|crewneck|sweater/.test(n)) return "SWEATSHIRT";
  if (/towel/.test(n)) return "Towel";
  if (/\bbag\b|pouch|tote/.test(n)) return "BAG";
  if (/napkin/.test(n)) return "NAPKIN";
  if (/\bhat\b|\bcap\b|beanie/.test(n)) return "HAT";
  if (/blanket/.test(n)) return "BLANKET";
  if (/wall art|hoop/.test(n)) return "WALL ART";
  if (/shirt|\btee\b/.test(n)) return "Shirt";
  return "OTHER";
}

let storeNames = new Map<number, string>();
let storesAt = 0;
async function shopName(storeId: number | null | undefined) {
  if (!storeId) return null;
  if (Date.now() - storesAt > 6 * 3600_000 || !storeNames.has(storeId)) {
    const stores = await ssGet<{ storeId: number; storeName: string }[]>("/stores?showInactive=true");
    storeNames = new Map(stores.map((s) => [s.storeId, s.storeName.trim()]));
    storesAt = Date.now();
  }
  return storeNames.get(storeId) ?? null;
}

/** Insert/update one ShipStation order. Returns false when it has no embroidered item. */
export async function upsertSsOrder(o: SsOrder): Promise<boolean> {
  const emb = o.items.filter(isEmb);
  if (!emb.length) return false;
  const products = [...new Set(emb.map((i) => productType(i.name ?? "")))].join(", ");
  const items = emb.map((i) => ({
    name: i.name, sku: i.sku, quantity: i.quantity, imageUrl: i.imageUrl,
    options: (i.options ?? []).map((p) => ({ name: p.name, value: p.value })),
  }));
  const data = {
    orderNumber: o.orderNumber,
    storeId: o.advancedOptions?.storeId ?? null,
    shopName: await shopName(o.advancedOptions?.storeId),
    // the Etsy purchase date; ShipStation's orderDate can be a later re-import
    orderDate: ssDate(o.paymentDate) ?? ssDate(o.orderDate) ?? new Date(),
    shipByDate: ssDate(o.shipByDate),
    ssStatus: o.orderStatus,
    shippedAt: o.orderStatus === "shipped" ? ssDate(o.shipDate) : null,
    customerName: o.shipTo?.name ?? null,
    products,
    items: items as Prisma.InputJsonValue,
    ssModifiedAt: ssDate(o.modifyDate),
  };
  const prev = await prisma.embOrder.findUnique({ where: { ssOrderId: o.orderId }, select: { printStatus: true, orderStatus: true } });
  // a cancelled order shows CANCELED in order status, and in print status unless it was already printed;
  // a value someone picked by hand is kept
  const cancel = o.orderStatus === "cancelled" ? {
    ...(!prev?.orderStatus ? { orderStatus: "CANCELED" } : {}),
    ...(!prev?.printStatus ? { printStatus: "CANCELED" } : {}),
  } : {};
  await prisma.embOrder.upsert({
    where: { ssOrderId: o.orderId },
    create: { ssOrderId: o.orderId, ...data, ...cancel },
    update: { ...data, ...cancel },
  });
  return true;
}

let running = false;
let lastRun: { at: Date; fetched: number; embroidery: number; error: string | null } | null = null;
export const syncStatus = () => lastRun;

/** Pull every order modified since the cursor (first run: the last 30 days). */
export async function syncShipStation(): Promise<void> {
  if (!ssConfigured() || running) return;
  running = true;
  let fetched = 0, embroidery = 0;
  try {
    const cur = await prisma.embSyncState.findUnique({ where: { key: CURSOR_KEY } });
    const since = cur ? DateTime.fromISO(cur.value, { zone: SS_TZ }).minus({ minutes: OVERLAP_MIN })
      : DateTime.now().setZone(SS_TZ).minus({ days: BACKFILL_DAYS });
    const sinceStr = since.toFormat("yyyy-MM-dd HH:mm:ss");
    let maxModify = cur?.value ?? since.toISO({ includeOffset: false })!;
    for (let page = 1; ; page++) {
      const r = await ssGet<{ orders: SsOrder[]; pages: number }>(
        `/orders?modifyDateStart=${encodeURIComponent(sinceStr)}&sortBy=ModifyDate&sortDir=ASC&pageSize=500&page=${page}`);
      for (const o of r.orders) {
        fetched++;
        if (await upsertSsOrder(o)) embroidery++;
        if (o.modifyDate > maxModify) maxModify = o.modifyDate;
      }
      if (page >= r.pages) break;
    }
    await prisma.embSyncState.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value: maxModify }, update: { value: maxModify } });
    lastRun = { at: new Date(), fetched, embroidery, error: null };
  } catch (e) {
    lastRun = { at: new Date(), fetched, embroidery, error: (e as Error).message };
    console.warn("Embroidery ShipStation sync:", (e as Error).message);
  } finally {
    running = false;
  }
}

/** A scanned order number that isn't here yet: ask ShipStation directly. */
export async function fetchByOrderNumber(orderNumber: string): Promise<boolean> {
  if (!ssConfigured()) return false;
  const r = await ssGet<{ orders: SsOrder[] }>(`/orders?orderNumber=${encodeURIComponent(orderNumber)}`);
  let found = false;
  for (const o of r.orders) if (o.orderNumber === orderNumber && (await upsertSsOrder(o))) found = true;
  return found;
}
