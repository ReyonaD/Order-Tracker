import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { requireAuth, requireRole, requireStockManager } from "../middleware/auth";
import { checkKey } from "./integrations";
import {
  addCategory, applyBatch, audit, dateBounds, deleteCategory, ensureWarehouse, inventory, listCategories, overview, renameCategory, reverseConsumption, setWarehouseMins, StockError,
  syncIfStale, syncWarehouses, transferStock, undoBatch, UNDO_MINUTES, UNITS,
} from "../services/stock";
import { buildSummary, getTelegramCfg, saveTelegramCfg, stockMessage, telegramSend } from "../services/stockTelegram";

// Stock Inventory. Viewing needs only an OT login; changing stock from the web needs
// canManageStock. Machine usage arrives through stockIntegrationRouter (the printer
// agents, via the DTF Monitor server), which has no user login: machine + operator
// identify who, and DTF Monitor tells which warehouse the machine belongs to.
export const stockRouter = Router();
stockRouter.use(requireAuth);

type Handler = (req: Request, res: Response) => Promise<void>;
function route(fn: Handler): Handler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof StockError) {
        res.status(e.status).json({ status: "error", code: e.code, params: e.params, message: e.message });
      } else if (e instanceof z.ZodError) {
        res.status(400).json({ status: "error", code: "invalid_request", message: "Invalid request" });
      } else {
        console.error("Stock:", e);
        res.status(500).json({ status: "error", code: "server", message: "The operation could not be completed." });
      }
    }
  };
}

async function actorName(req: Request): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
  return u?.name || req.user!.email;
}

async function canManage(req: Request): Promise<boolean> {
  if (req.user!.role === "ADMIN") return true;
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { canManageStock: true } });
  return !!u?.canManageStock;
}

const requestId = z.string().regex(/^[a-f0-9]{32}$/);
const lines = z.array(z.object({ productId: z.number().int().positive(), quantity: z.union([z.string(), z.number()]) })).min(1).max(100);

stockRouter.get("/overview", route(async (req, res) => {
  await syncIfStale();
  res.json({
    status: "success", ...(await overview()), canManage: await canManage(req), isAdmin: req.user!.role === "ADMIN",
    dtfConfigured: !!(env.dtfMonitorUrl && env.dtfMonitorApiKey), units: UNITS, categories: await listCategories(),
  });
}));

stockRouter.get("/inventory", route(async (req, res) => {
  res.json({ status: "success", items: await inventory(Number(req.query.warehouse)) });
}));

const batchSchema = z.object({
  warehouseId: z.number().int().positive(), type: z.enum(["in", "out"]), items: lines,
  note: z.string().optional(), requestId,
});
stockRouter.post("/batch", requireStockManager, route(async (req, res) => {
  const b = batchSchema.parse(req.body);
  const created = await applyBatch({
    ...b, requestKey: `user:${req.user!.id}:${b.requestId}`, who: { actor: await actorName(req), source: "web" },
  });
  res.json({ status: "success", created });
}));

const transferSchema = z.object({
  sourceId: z.number().int().positive(), destinationId: z.number().int().positive(), productId: z.number().int().positive(),
  quantity: z.union([z.string(), z.number()]), note: z.string().optional(),
});
stockRouter.post("/transfer", requireStockManager, route(async (req, res) => {
  const b = transferSchema.parse(req.body);
  await transferStock(b.sourceId, b.destinationId, b.productId, b.quantity, b.note, { actor: await actorName(req), source: "web" });
  res.json({ status: "success" });
}));

stockRouter.post("/movements/:id/reverse", requireStockManager, route(async (req, res) => {
  await reverseConsumption(Number(req.params.id), { actor: await actorName(req), source: "web" });
  res.json({ status: "success" });
}));

const movementRow = (m: Prisma.StockMovementGetPayload<{ include: { product: true; warehouse: true } }>) => ({
  id: m.id, warehouse: m.warehouse.name, product: m.product.name, unit: m.product.unit, type: m.type, kind: m.kind,
  quantity: Number(m.quantity), before: Number(m.before), after: Number(m.after), note: m.note, actor: m.actor,
  machine: m.machine, source: m.source, reversedAt: m.reversedAt, createdAt: m.createdAt,
});

const PAGE = 25;
stockRouter.get("/history", route(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const where: Prisma.StockMovementWhereInput = req.query.warehouse ? { warehouseId: Number(req.query.warehouse) } : {};
  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { product: true, warehouse: true } }),
  ]);
  res.json({ status: "success", total, page, pageSize: PAGE, rows: rows.map(movementRow) });
}));

const REPORT_LIMIT = 10000;
stockRouter.get("/report", route(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const where: Prisma.StockMovementWhereInput = {
    kind: "consumption", reversedAt: null, createdAt: dateBounds(q.from || "", q.to || ""),
    ...(q.warehouse ? { warehouseId: Number(q.warehouse) } : {}),
    ...(q.product ? { productId: Number(q.product) } : {}),
    ...(q.actor ? { actor: q.actor } : {}),
    ...(q.machine ? { machine: q.machine } : {}),
  };
  const rows = await prisma.stockMovement.findMany({ where, orderBy: { id: "desc" }, take: REPORT_LIMIT + 1, include: { product: true, warehouse: true } });
  if (rows.length > REPORT_LIMIT) throw new StockError("report_too_big", "Over 10,000 records. Select a shorter date range.");
  const out = rows.map(movementRow);
  const totals: Record<string, number> = {};
  for (const r of out) totals[r.unit] = Math.round(((totals[r.unit] ?? 0) + r.quantity) * 100) / 100;
  res.json({
    status: "success", rows: out, totals,
    actors: [...new Set(out.map((r) => r.actor).filter(Boolean))].sort(),
    machines: [...new Set(out.map((r) => r.machine).filter(Boolean))].sort(),
  });
}));

stockRouter.get("/audit", requireStockManager, route(async (_req, res) => {
  res.json({ status: "success", rows: await prisma.stockAudit.findMany({ orderBy: { id: "desc" }, take: 100 }) });
}));

// ---- products ----

const productSchema = z.object({
  name: z.string().trim().min(1).max(150), category: z.string(),
  unit: z.enum(UNITS as [string, ...string[]]), minStock: z.union([z.string(), z.number()]), active: z.boolean().default(true),
});
async function checkCategory(name: string) {
  if (!(await listCategories()).includes(name)) throw new StockError("invalid_product", "Check the category, unit and minimum quantity.");
}
function parseMin(v: string | number): string {
  const s = String(v).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) throw new StockError("invalid_product", "Check the category, unit and minimum quantity.");
  return s;
}

stockRouter.get("/products", route(async (_req, res) => {
  const rows = await prisma.stockProduct.findMany({ orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }] });
  res.json({ status: "success", rows: rows.map((p) => ({ ...p, minStock: Number(p.minStock) })) });
}));

stockRouter.post("/products", requireStockManager, route(async (req, res) => {
  const b = productSchema.parse(req.body);
  await checkCategory(b.category);
  const p = await prisma.stockProduct.create({ data: { ...b, minStock: parseMin(b.minStock) } });
  await audit(await actorName(req), "product.save", `#${p.id} ${p.name}`);
  res.json({ status: "success", id: p.id });
}));

stockRouter.put("/products/:id", requireStockManager, route(async (req, res) => {
  const id = Number(req.params.id);
  const b = productSchema.parse(req.body);
  await checkCategory(b.category);
  const prev = await prisma.stockProduct.findUnique({ where: { id } });
  if (!prev) throw new StockError("not_found", "Product not found.", {}, 404);
  if (prev.unit !== b.unit && await prisma.stockMovement.count({ where: { productId: id } })) {
    throw new StockError("unit_locked", "The unit of a product with history cannot change. Create a new product.");
  }
  await prisma.stockProduct.update({ where: { id }, data: { ...b, minStock: parseMin(b.minStock) } });
  await audit(await actorName(req), "product.save", `#${id} ${b.name}`);
  res.json({ status: "success" });
}));

const minsSchema = z.object({ mins: z.record(z.union([z.string(), z.number(), z.null()])) });
stockRouter.put("/products/:id/mins", requireStockManager, route(async (req, res) => {
  const { mins } = minsSchema.parse(req.body);
  const clean: Record<string, string | null> = {};
  for (const [id, v] of Object.entries(mins)) clean[id] = v === null || String(v).trim() === "" ? null : parseMin(String(v).trim().replace(",", "."));
  await setWarehouseMins(Number(req.params.id), clean, await actorName(req));
  res.json({ status: "success" });
}));

// ---- categories ----

stockRouter.post("/categories", requireStockManager, route(async (req, res) => {
  await addCategory(req.body?.name, await actorName(req));
  res.json({ status: "success" });
}));

stockRouter.put("/categories", requireStockManager, route(async (req, res) => {
  await renameCategory(String(req.body?.from ?? ""), req.body?.to, await actorName(req));
  res.json({ status: "success" });
}));

stockRouter.delete("/categories", requireStockManager, route(async (req, res) => {
  await deleteCategory(String(req.query.name ?? ""), await actorName(req));
  res.json({ status: "success" });
}));

stockRouter.post("/warehouses/sync", requireStockManager, route(async (_req, res) => {
  if (!env.dtfMonitorUrl || !env.dtfMonitorApiKey) throw new StockError("dtf_not_configured", "DTF Monitor integration is not configured.");
  try {
    await syncWarehouses();
  } catch {
    throw new StockError("dtf_unreachable", "Could not reach DTF Monitor.", {}, 502);
  }
  res.json({ status: "success" });
}));

// ---- Telegram (admins) ----

const notifications = () => prisma.stockNotification.findMany({
  orderBy: { id: "desc" }, take: 20, select: { id: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true },
});

stockRouter.get("/telegram", requireRole("ADMIN"), route(async (_req, res) => {
  const { token, ...cfg } = await getTelegramCfg();
  res.json({ status: "success", ...cfg, hasToken: !!token, tokenFromEnv: !!env.telegramBotToken, log: await notifications() });
}));

const telegramSchema = z.object({
  token: z.string().trim().optional(), chatId: z.string().trim().regex(/^(-?\d+)?$/), enabled: z.boolean(),
  summaryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), lang: z.enum(["en", "tr", "es"]),
});
stockRouter.put("/telegram", requireRole("ADMIN"), route(async (req, res) => {
  const b = telegramSchema.parse(req.body);
  if (b.token && !/^\d{5,}:[a-zA-Z0-9_-]{20,}$/.test(b.token)) throw new StockError("invalid_token", "The bot token is not in a valid format.");
  const current = await getTelegramCfg();
  if (b.enabled && (!(b.token || current.token) || !b.chatId)) throw new StockError("telegram_incomplete", "A bot token and chat id are needed to enable it.");
  const { token, ...rest } = b;
  await saveTelegramCfg(token ? { ...rest, token } : rest);
  await audit(await actorName(req), "telegram.settings");
  res.json({ status: "success" });
}));

async function activeTelegram() {
  const cfg = await getTelegramCfg(true);
  if (!cfg) throw new StockError("telegram_off", "Telegram is not enabled.");
  return cfg;
}

stockRouter.post("/telegram/test", requireRole("ADMIN"), route(async (_req, res) => {
  const cfg = await activeTelegram();
  await telegramSend(cfg, stockMessage(cfg.lang, "test"));
  res.json({ status: "success" });
}));

stockRouter.post("/telegram/summary", requireRole("ADMIN"), route(async (_req, res) => {
  const cfg = await activeTelegram();
  await telegramSend(cfg, await buildSummary("summary", cfg.lang));
  res.json({ status: "success" });
}));

// ---- printer agents, through the DTF Monitor server (X-Api-Key) ----

export const stockIntegrationRouter = Router();
stockIntegrationRouter.use(checkKey);

// What this machine's Stock tab shows: the warehouse's products + its recent usage.
stockIntegrationRouter.get("/state", route(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const warehouse = await ensureWarehouse(q.warehouse || "");
  const machine = q.machine || "";
  const recent = await prisma.stockMovement.findMany({
    where: { machine, kind: "consumption", createdAt: { gte: new Date(Date.now() - 86400000) } },
    orderBy: { id: "desc" }, take: 20, include: { product: true },
  });
  const limit = Date.now() - UNDO_MINUTES * 60000;
  res.json({
    status: "success", warehouse: warehouse.name,
    items: await inventory(warehouse.id), categories: await listCategories(), defaultCategory: q.category || "",
    recent: recent.map((m) => ({
      id: m.id, product: m.product.name, unit: m.product.unit, quantity: Number(m.quantity), actor: m.actor, createdAt: m.createdAt,
      reversed: !!m.reversedAt, undoable: !m.reversedAt && !!m.batchKey && m.createdAt.getTime() >= limit,
      requestId: m.batchKey?.split(":").pop() ?? "",
    })),
  });
}));

const agentKey = (machine: string, id: string) => `agent:${machine}:${id}`;

const useSchema = z.object({
  warehouse: z.string().min(1), machine: z.string().min(1), operator: z.string().optional(), items: lines,
  note: z.string().optional(), requestId,
});
stockIntegrationRouter.post("/use", route(async (req, res) => {
  const b = useSchema.parse(req.body);
  const warehouse = await ensureWarehouse(b.warehouse);
  const created = await applyBatch({
    warehouseId: warehouse.id, type: "out", items: b.items, note: b.note, requestKey: agentKey(b.machine, b.requestId),
    who: { actor: b.operator || b.machine, machine: b.machine, source: "agent" },
  });
  res.json({ status: "success", created, warehouse: warehouse.name });
}));

const undoSchema = z.object({ machine: z.string().min(1), operator: z.string().optional(), requestId });
stockIntegrationRouter.post("/undo", route(async (req, res) => {
  const b = undoSchema.parse(req.body);
  const undone = await undoBatch(agentKey(b.machine, b.requestId), b.machine, { actor: b.operator || b.machine, machine: b.machine, source: "agent" });
  res.json({ status: "success", undone });
}));
