// Shopify-linked stock (e.g. Cheetah's blank T-shirts). A product whose shopifyKey matches a
// sold line item ("STORE|product title|variant title", lowercased) is taken out of the
// warehouse named like the store when the order arrives, and put back if it is cancelled.
// Walk-in sales are ordinary "stock out" usage in the Stock tab.
import { Store } from "@prisma/client";
import { prisma } from "../db";
import { applyBatch, audit, reverseOne, StockError } from "./stock";
import { getTelegramCfg } from "./stockTelegram";
import { ShopifyOrderPayload, extractOrderId, normalizeOrderName } from "./shopify";

type LineItem = { title?: string; variant_title?: string | null; quantity?: number; current_quantity?: number };

const WHO = { actor: "Shopify", source: "shopify" as const };
const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
// Variant names drift ("Dark Grey Heather" vs "Heather Dark Grey", "navy-1"): in each " / " part the
// words are sorted, hyphens split and number-only words dropped. The migration seeding the keys does the same.
const part = (p: string) => p.toLowerCase().split(/[\s-]+/).filter((w) => w && !/^\d+$/.test(w)).sort().join(" ");
export const shopifyKeyOf = (storeCode: string, title: unknown, variant: unknown) =>
  `${norm(storeCode)}|${norm(title)}|${String(variant ?? "").split("/").map(part).join("/")}`;
const batchKey = (store: Store, orderId: string) => `shopify:${store.code}:${orderId}`;

/** Take the order's linked products out of stock. Safe to call again for the same order
 *  (re-delivered webhook, reprocess): an order is applied once. */
export async function stockForShopifyOrder(store: Store, data: ShopifyOrderPayload): Promise<number> {
  if (data.cancelled_at) return 0;
  const items = (data.line_items || []) as LineItem[];
  const wanted = new Map<string, number>();
  for (const li of items) {
    const qty = Number(li.quantity ?? 0);
    if (qty > 0) {
      const key = shopifyKeyOf(store.code, li.title, li.variant_title);
      wanted.set(key, (wanted.get(key) ?? 0) + qty);
    }
  }
  if (!wanted.size) return 0;
  const products = await prisma.stockProduct.findMany({ where: { shopifyKey: { in: [...wanted.keys()] }, active: true } });
  // a linked product line (same store + title) whose variant matched nothing: a new color/size in Shopify
  const found = new Set(products.map((p) => p.shopifyKey));
  for (const key of wanted.keys()) {
    if (found.has(key)) continue;
    const family = key.slice(0, key.lastIndexOf("|") + 1);
    if (await prisma.stockProduct.count({ where: { shopifyKey: { startsWith: family } } })) {
      console.warn(`Shopify stock: no product for ${key}`);
      await audit("Shopify", "shopify.unmatched", `${normalizeOrderName(String(data.name || ""))} ${key}`);
    }
  }
  if (!products.length) return 0;
  const warehouse = await prisma.stockWarehouse.findFirst({ where: { name: { equals: store.code, mode: "insensitive" }, active: true } });
  if (!warehouse) {
    console.warn(`Shopify stock: no active warehouse named ${store.code}`);
    return 0;
  }
  const orderId = extractOrderId(data);
  try {
    await applyBatch({
      warehouseId: warehouse.id, type: "out", requestKey: batchKey(store, orderId),
      items: products.map((p) => ({ productId: p.id, quantity: wanted.get(p.shopifyKey!)! })),
      note: `Shopify ${normalizeOrderName(String(data.name || orderId))}`, who: WHO, takeWhatIsThere: true,
    });
  } catch (e) {
    // the same order delivered again with a different payload (an edit) — it was already taken out once
    if (e instanceof StockError && e.code === "request_reused") return 0;
    throw e;
  }
  return products.length;
}

/** The order was cancelled: put back whatever it took out (once). */
export async function restockCancelledShopifyOrder(store: Store, data: ShopifyOrderPayload): Promise<number> {
  const moves = await prisma.stockMovement.findMany({
    where: { batchKey: batchKey(store, extractOrderId(data)), kind: "consumption", reversedAt: null },
  });
  if (!moves.length) return 0;
  const tg = await getTelegramCfg(true);
  await prisma.$transaction(async (tx) => {
    for (const m of moves) await reverseOne(tx, m.id, WHO, tg);
    await audit("Shopify", "shopify.cancel", `${store.code} ${normalizeOrderName(String(data.name || ""))} / ${moves.length} item(s)`, tx);
  });
  return moves.length;
}
