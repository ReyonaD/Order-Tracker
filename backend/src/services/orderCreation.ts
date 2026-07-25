import { Store } from "@prisma/client";
import { prisma } from "../db";
import { calculateDeadline } from "./deadline";
import { determineItemTypes, shouldAutoLoad } from "./itemTypes";
import { resolveShipping } from "./shipping";
import {
  ShopifyOrderPayload,
  buildOrderUrl,
  extractOrderId,
  normalizeOrderName,
} from "./shopify";

export interface CreationResult {
  status: "created" | "duplicate";
  orderName: string;
  orderId: string;
}

/**
 * Handle an orders/create webhook. Idempotent: uses shopifyOrderId as the unique
 * key, so a duplicate delivery updates the existing row instead of creating a new one.
 */
export async function handleOrderCreation(
  store: Store,
  data: ShopifyOrderPayload
): Promise<CreationResult> {
  const orderName = normalizeOrderName(String(data.name || ""));
  const orderId = extractOrderId(data);

  const shipping = resolveShipping(store.code, data.shipping_lines);
  const orderDate = new Date(data.created_at || Date.now());

  const { deadlineAt, deadlineHour } = calculateDeadline({
    orderDate,
    timezone: store.timezone,
    cutoffHour: shipping.isPickup ? store.pickupCutoffHour : store.shippingCutoffHour,
    isPickup: shipping.isPickup,
    shippingMethod: shipping.shippingMethod,
  });

  const itemTypes = determineItemTypes(data.line_items || []);
  const orderUrl = buildOrderUrl(store.shopifyIdentifier, orderId);
  // Sample / T-shirt orders don't need a design-file upload, so they're
  // auto-marked "Uploaded" (matches the original sheet behavior on column H).
  const autoUploadStatus = shouldAutoLoad(itemTypes.displayText) ? "Uploaded" : null;

  // Shopify order total (total_price), fall back to current_total_price.
  const rawTotal = data.total_price ?? data.current_total_price;
  const totalPrice = rawTotal != null && !isNaN(Number(rawTotal)) ? Number(rawTotal) : null;

  const existing = await prisma.order.findUnique({
    where: { shopifyOrderId: orderId },
    select: { id: true },
  });

  await prisma.order.upsert({
    where: { shopifyOrderId: orderId },
    create: {
      shopifyOrderId: orderId,
      orderName,
      storeId: store.id,
      storeCode: store.code,
      shippingMethod: shipping.shippingMethod,
      displayShippingMethod: shipping.displayShippingMethod,
      isPickup: shipping.isPickup,
      orderDate,
      deadlineAt,
      deadlineHour,
      itemTypes: itemTypes.types,
      lineItems: (data.line_items as object[]) ?? undefined,
      totalPrice,
      orderUrl,
      status: "NEW",
      uploadStatus: autoUploadStatus,
    },
    update: {
      // On a re-delivery, refresh Shopify-sourced fields but never clobber
      // manual workflow columns (designer, machinist, notes, status).
      orderName,
      shippingMethod: shipping.shippingMethod,
      displayShippingMethod: shipping.displayShippingMethod,
      isPickup: shipping.isPickup,
      orderDate,
      deadlineAt,
      deadlineHour,
      itemTypes: itemTypes.types,
      lineItems: (data.line_items as object[]) ?? undefined,
      totalPrice,
      orderUrl,
    },
  });

  return {
    status: existing ? "duplicate" : "created",
    orderName,
    orderId,
  };
}
