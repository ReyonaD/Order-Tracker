// Helpers for parsing Shopify webhook payloads.

export interface ShopifyOrderPayload {
  id?: number | string;
  order_id?: number | string;
  name?: string;
  order_number?: string | number;
  order_name?: string;
  admin_graphql_api_id?: string;
  created_at?: string;
  cancelled_at?: string;
  cancel_reason?: string;
  financial_status?: string;
  shop_domain?: string;
  store?: string;
  shipping_lines?: Array<{ title?: string }>;
  total_price?: string | number;
  current_total_price?: string | number;
  line_items?: Array<{ name?: string; title?: string; description?: string; price?: string; quantity?: number }>;
  tracking_number?: string;
  tracking_numbers?: string[];
  tracking_url?: string;
  tracking_urls?: string[];
  [key: string]: unknown;
}

/** Normalize an order name to always include a leading "#". */
export function normalizeOrderName(raw: string): string {
  if (!raw) return "";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

/** Extract the numeric Shopify order id as a string, from several possible fields. */
export function extractOrderId(data: ShopifyOrderPayload): string {
  if (data.id != null) return String(data.id);
  if (data.order_id != null) return String(data.order_id);
  if (data.admin_graphql_api_id && data.admin_graphql_api_id.includes("/Order/")) {
    const m = data.admin_graphql_api_id.match(/\/Order\/(\d+)/);
    if (m && m[1]) return m[1];
  }
  return String(data.name || "").replace("#", "");
}

/** Build the Shopify admin order URL for a store. */
export function buildOrderUrl(shopifyIdentifier: string, orderId: string): string {
  return `https://admin.shopify.com/store/${shopifyIdentifier}/orders/${orderId}`;
}

/**
 * Classify a webhook payload when the topic header is missing/ambiguous.
 * Mirrors the heuristics from the original processQueue().
 */
export function classifyWebhook(
  topic: string,
  data: ShopifyOrderPayload
): "cancellation" | "fulfillment" | "creation" {
  const t = (topic || "").toLowerCase();

  const isCancellation =
    t.includes("orders/cancelled") ||
    !!data.cancelled_at ||
    !!data.cancel_reason ||
    data.financial_status === "voided";
  if (isCancellation) return "cancellation";

  const isFulfillment =
    t.includes("fulfillment") ||
    (!!data.order_id && !data.checkout_id) ||
    !!data.tracking_number ||
    (Array.isArray(data.tracking_numbers) && data.tracking_numbers.length > 0) ||
    (!!data.name && String(data.name).includes("."));
  if (isFulfillment) return "fulfillment";

  return "creation";
}
