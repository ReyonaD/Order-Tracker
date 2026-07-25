import { Store } from "@prisma/client";
import { classifyWebhook, ShopifyOrderPayload } from "./shopify";
import { handleOrderCreation } from "./orderCreation";
import { handleFulfillment } from "./fulfillment";
import { handleCancellation } from "./cancellation";

export interface ProcessResult {
  kind: "creation" | "fulfillment" | "cancellation";
  result: { status: string; orderName?: string };
  unmatched: boolean; // fulfillment/cancellation whose order isn't in the DB (yet)
}

/**
 * Route a webhook payload to the right handler. Used by the live webhook endpoint
 * and by the reprocess action, so both behave identically.
 */
export async function processWebhook(
  store: Store,
  topic: string,
  data: ShopifyOrderPayload
): Promise<ProcessResult> {
  const kind = classifyWebhook(topic, data);
  let result: { status: string; orderName?: string };

  if (kind === "cancellation") {
    result = await handleCancellation(store.id, data);
  } else if (kind === "fulfillment") {
    result = await handleFulfillment(store.id, data);
  } else {
    result = await handleOrderCreation(store, data);
  }

  const unmatched = result.status === "not_found";
  return { kind, result, unmatched };
}
