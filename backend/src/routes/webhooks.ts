import { Router, raw } from "express";
import { prisma } from "../db";
import { verifyShopifyWebhook } from "../middleware/shopifyHmac";
import { classifyWebhook, ShopifyOrderPayload } from "../services/shopify";
import { processWebhook } from "../services/processWebhook";

export const webhookRouter = Router();

// Shopify webhook endpoint. Configure one webhook per topic in each store pointing at:
//   POST https://<host>/webhooks/<STORE_CODE>
// The topic is read from the X-Shopify-Topic header; if absent we classify by payload.
//
// Reliability: every verified webhook is written to WebhookEvent BEFORE processing,
// so nothing is lost even if a handler throws. On an unexpected error we return 500
// so Shopify retries (up to ~19 times over 48h); the raw event can also be replayed.
webhookRouter.post(
  "/:store",
  raw({ type: "*/*", limit: "2mb" }),
  verifyShopifyWebhook,
  async (req, res) => {
    const store = req.store!;
    const data = (req.shopifyPayload || {}) as ShopifyOrderPayload;
    const topic = String(req.get("X-Shopify-Topic") || "");
    const kind = classifyWebhook(topic, data);

    // 1) Persist the raw event first — the durable inbox.
    const event = await prisma.webhookEvent.create({
      data: {
        storeCode: store.code,
        topic,
        kind,
        orderName: typeof data.name === "string" ? data.name : null,
        payload: data as object,
        status: "received",
      },
    });

    // 2) Process, then record the outcome on the event.
    try {
      const { result, unmatched } = await processWebhook(store, topic, data);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: unmatched ? "unmatched" : "processed",
          message: JSON.stringify(result),
          orderName: result.orderName ?? event.orderName,
          processedAt: new Date(),
        },
      });
      res.json({ status: "success", kind, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Webhook processing error";
      console.error(`[webhook] ${store.code}/${kind} error:`, message);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: "error", message: message.slice(0, 500) },
      });
      // 500 => Shopify will retry; the raw event is stored for replay regardless.
      res.status(500).json({ status: "error", kind, message });
    }
  }
);
