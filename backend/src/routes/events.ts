import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { processWebhook } from "../services/processWebhook";
import { ShopifyOrderPayload } from "../services/shopify";

export const eventRouter = Router();

eventRouter.use(requireAuth, requireRole("ADMIN"));

// List recent webhook events (optionally filter by status). Counts help spot misses.
const listQuery = z.object({
  status: z.enum(["received", "processed", "unmatched", "error"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
});

eventRouter.get("/", async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid query" });
    return;
  }
  const { status, page, pageSize } = parsed.data;
  const where = status ? { status } : {};

  const [total, events, counts] = await Promise.all([
    prisma.webhookEvent.count({ where }),
    prisma.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, storeCode: true, topic: true, kind: true, orderName: true,
        status: true, message: true, receivedAt: true, processedAt: true,
      },
    }),
    prisma.webhookEvent.groupBy({ by: ["status"], _count: true }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c._count;

  res.json({ status: "success", total, page, pageSize, events, counts: byStatus });
});

// Replay a stored event through the handlers (e.g. after fixing a bug, or once the
// matching order has since been created).
eventRouter.post("/:id/reprocess", async (req, res) => {
  const event = await prisma.webhookEvent.findUnique({ where: { id: req.params.id } });
  if (!event) {
    res.status(404).json({ status: "error", message: "Event not found" });
    return;
  }
  const store = await prisma.store.findUnique({ where: { code: event.storeCode } });
  if (!store) {
    res.status(400).json({ status: "error", message: `Unknown store: ${event.storeCode}` });
    return;
  }

  try {
    const { result, unmatched } = await processWebhook(
      store,
      event.topic,
      event.payload as ShopifyOrderPayload
    );
    const updated = await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: unmatched ? "unmatched" : "processed",
        message: JSON.stringify(result),
        orderName: result.orderName ?? event.orderName,
        processedAt: new Date(),
      },
    });
    res.json({ status: "success", event: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reprocess error";
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "error", message: message.slice(0, 500) },
    });
    res.status(500).json({ status: "error", message });
  }
});
