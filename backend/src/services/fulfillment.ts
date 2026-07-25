import { prisma } from "../db";
import { ShopifyOrderPayload } from "./shopify";

export interface FulfillmentResult {
  status: "fulfilled" | "not_found";
  orderName?: string;
}

/**
 * Handle a fulfillment webhook: attach tracking info (if any) and mark FULFILLED.
 * Matches the original handleFulfillmentCreation() search logic but against the DB.
 */
export async function handleFulfillment(
  storeId: string | null,
  data: ShopifyOrderPayload
): Promise<FulfillmentResult> {
  const trackingNumber =
    data.tracking_number ||
    (data.tracking_numbers && data.tracking_numbers.length > 0
      ? data.tracking_numbers[0]
      : undefined);
  const trackingUrl =
    data.tracking_url ||
    (data.tracking_urls && data.tracking_urls.length > 0
      ? data.tracking_urls[0]
      : undefined);

  // Resolve the order name/number from the various fulfillment fields.
  let orderName = "";
  if (data.order_name) orderName = String(data.order_name);
  if (data.name) {
    const n = String(data.name);
    // Fulfillment names often look like "#1234.1" — take the part before the dot.
    orderName = n.includes(".") ? n.split(".")[0] : n;
  }

  const orderId = data.order_id != null ? String(data.order_id) : "";
  const numberOnly = orderName.replace(/^#/, "");

  // Try, in order: shopify order id, exact name, "#"+number, number-only.
  const order = await prisma.order.findFirst({
    where: {
      ...(storeId ? { storeId } : {}),
      OR: [
        ...(orderId ? [{ shopifyOrderId: orderId }] : []),
        ...(orderName ? [{ orderName }] : []),
        ...(numberOnly ? [{ orderName: `#${numberOnly}` }] : []),
        ...(numberOnly ? [{ orderName: numberOnly }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  if (!order) {
    return { status: "not_found", orderName };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "FULFILLED",
      // Pickup orders don't get a tracking number; only set when present.
      trackingNumber: trackingNumber ?? order.trackingNumber,
      trackingUrl: trackingUrl ?? order.trackingUrl,
    },
  });

  return { status: "fulfilled", orderName: order.orderName };
}
