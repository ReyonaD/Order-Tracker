import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { Store } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";

// Extend Express Request to carry the resolved store + parsed payload.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      store?: Store;
      shopifyPayload?: Record<string, unknown>;
      rawBody?: Buffer;
    }
  }
}

/**
 * Verify the Shopify HMAC signature against the per-store secret, then attach the
 * store and parsed JSON payload to the request. Requires the raw body (Buffer),
 * so the webhook route must use express.raw().
 */
export async function verifyShopifyWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const storeCode = String(req.params.store || "").toUpperCase();
    const store = await prisma.store.findUnique({ where: { code: storeCode } });

    if (!store || !store.active) {
      res.status(404).json({ status: "error", message: `Unknown store: ${storeCode}` });
      return;
    }

    const rawBody: Buffer = req.body instanceof Buffer ? req.body : Buffer.from("");

    if (!env.skipWebhookVerification) {
      if (!store.webhookSecret) {
        res.status(401).json({ status: "error", message: "Store has no webhook secret configured" });
        return;
      }
      const hmacHeader = String(req.get("X-Shopify-Hmac-Sha256") || "");
      const digest = crypto
        .createHmac("sha256", store.webhookSecret)
        .update(rawBody)
        .digest("base64");

      const valid =
        hmacHeader.length === digest.length &&
        crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(digest));

      if (!valid) {
        res.status(401).json({ status: "error", message: "Invalid HMAC signature" });
        return;
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8") || "{}");
    } catch {
      res.status(400).json({ status: "error", message: "Invalid JSON body" });
      return;
    }

    req.store = store;
    req.shopifyPayload = payload;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook verification error";
    res.status(500).json({ status: "error", message });
  }
}
