import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const storeRouter = Router();

storeRouter.use(requireAuth);

// List stores (used for UI filters + admin). The secret itself is never returned,
// only a boolean showing whether one is configured.
storeRouter.get("/", async (_req, res) => {
  const rows = await prisma.store.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, name: true, color: true,
      shopifyIdentifier: true, timezone: true,
      pickupCutoffHour: true, shippingCutoffHour: true,
      webhookSecret: true,
    },
  });
  const stores = rows.map(({ webhookSecret, ...s }) => ({ ...s, hasSecret: !!webhookSecret }));
  res.json({ status: "success", stores });
});

// Admin: create a new store.
const createSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  color: z.string().default("#FFFFFF"),
  shopifyIdentifier: z.string().min(1),
  timezone: z.string().default("America/Chicago"),
  pickupCutoffHour: z.number().int().min(0).max(23).default(14),
  shippingCutoffHour: z.number().int().min(0).max(23).default(14),
  webhookSecret: z.string().optional(),
});

storeRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  const code = parsed.data.code.trim().toUpperCase().replace(/\s+/g, "");
  try {
    const store = await prisma.store.create({
      data: { ...parsed.data, code },
      select: { id: true, code: true, name: true, color: true },
    });
    res.status(201).json({ status: "success", store });
  } catch {
    res.status(409).json({ status: "error", message: `Store code "${code}" already exists` });
  }
});

// Admin: configure a store (including its Shopify webhook secret).
const updateSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  shopifyIdentifier: z.string().optional(),
  timezone: z.string().optional(),
  pickupCutoffHour: z.number().int().min(0).max(23).optional(),
  shippingCutoffHour: z.number().int().min(0).max(23).optional(),
  webhookSecret: z.string().optional(),
  active: z.boolean().optional(),
});

storeRouter.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  try {
    const store = await prisma.store.update({
      where: { id: req.params.id },
      data: parsed.data,
      select: { id: true, code: true, name: true, color: true, timezone: true },
    });
    res.json({ status: "success", store });
  } catch {
    res.status(404).json({ status: "error", message: "Store not found" });
  }
});
