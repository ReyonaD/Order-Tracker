import { prisma } from "../db";
import { ShopifyOrderPayload, extractOrderId, normalizeOrderName } from "./shopify";

export interface CancellationResult {
  status: "cancelled" | "not_found";
  orderName?: string;
}

/**
 * Handle an orders/cancelled webhook: mark the order CANCELLED.
 * The red-row styling from the sheet becomes a status the frontend renders.
 */
export async function handleCancellation(
  storeId: string | null,
  data: ShopifyOrderPayload
): Promise<CancellationResult> {
  const orderId = extractOrderId(data);
  const orderName = normalizeOrderName(String(data.name || data.order_number || ""));
  const numberOnly = orderName.replace(/^#/, "");

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
    data: { status: "CANCELLED" },
  });

  return { status: "cancelled", orderName: order.orderName };
}
