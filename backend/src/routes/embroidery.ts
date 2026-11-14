// Embroidery: the EMB-EMBROIDERY ORDERS sheet as a page. Orders come from ShipStation,
// design links from Dropbox, PRINTED from a packing-slip barcode scan; the rest is manual.
import { Request, Response, Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, requireEmbroidery } from "../middleware/auth";
import { fetchByOrderNumber, ssConfigured, syncShipStation, syncStatus } from "../services/embroiderySync";
import { dbxConfigured, dbxStatus, syncDropbox, temporaryLink } from "../services/embroideryDropbox";

export const embroideryRouter = Router();
embroideryRouter.use(requireAuth, requireEmbroidery);

// Express 4 doesn't catch async errors: answer 500 instead of leaving the request hanging
type H = (req: Request, res: Response) => Promise<void>;
const safe = (h: H) => (req: Request, res: Response) => h(req, res).catch((e) => {
  console.error("Embroidery:", e);
  if (!res.headersSent) res.status(500).json({ status: "error", message: (e as Error).message });
});

export const EMB_COLUMNS = ["customerService", "orderStatus", "designStatus", "logoOrText", "preparedBy", "printStatus"] as const;
const PAGE = 200;
const READY_DESIGN = "READY DESIGN";
const CANCELED = "CANCELED";

const userName = async (id: string) => (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;

async function withDesigns<T extends { orderNumber: string }>(orders: T[]) {
  const files = await prisma.embDesignFile.findMany({
    where: { orderNumber: { in: [...new Set(orders.map((o) => o.orderNumber))] } },
    select: { id: true, name: true, orderNumber: true, uploadedAt: true }, orderBy: { uploadedAt: "asc" },
  });
  return orders.map((o) => ({ ...o, designs: files.filter((f) => f.orderNumber === o.orderNumber) }));
}

// The floor buys every label in the morning, then embroiders: "To do" = label created
// (ShipStation status "shipped") and not printed yet. Labels bought before the page went
// live (EMB_TODO_FROM, a YYYY-MM-DD) were handled on the old sheet and stay out of To do.
const TODO_FROM = new Date(`${process.env.EMB_TODO_FROM || "2026-11-01"}T00:00:00-08:00`);
const notDone: Prisma.EmbOrderWhereInput = { OR: [{ printStatus: null }, { printStatus: { notIn: ["PRINTED", "CANCELED"] } }] };
const VIEW_WHERE: Record<string, Prisma.EmbOrderWhereInput> = {
  todo: { AND: [notDone, { ssStatus: "shipped", shippedAt: { gte: TODO_FROM } }] },
  nolabel: { AND: [notDone, { ssStatus: { notIn: ["shipped", "cancelled"] } }] },
  // a ready-made design needs no file in Dropbox
  nodesign: { AND: [notDone, { OR: [{ ssStatus: "shipped", shippedAt: { gte: TODO_FROM } }, { ssStatus: { notIn: ["shipped", "cancelled"] } }] },
    { OR: [{ designStatus: null }, { designStatus: { not: READY_DESIGN } }] }] },
  printed: { printStatus: "PRINTED" },
  labelled: { ssStatus: "shipped" },
  cancelled: { OR: [{ ssStatus: "cancelled" }, { printStatus: "CANCELED" }, { orderStatus: "CANCELED" }] },
  all: {},
};
const OLDEST_FIRST = new Set(["todo", "nolabel", "nodesign"]);

embroideryRouter.get("/orders", safe(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const view = VIEW_WHERE[String(req.query.view)] ? String(req.query.view) : "todo";
  const shop = String(req.query.shop ?? "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const where: Prisma.EmbOrderWhereInput = {
    AND: [
      VIEW_WHERE[view],
      shop ? { shopName: shop } : {},
      q ? { OR: [
        { orderNumber: { contains: q } },
        { customerName: { contains: q, mode: "insensitive" } },
        { shopName: { contains: q, mode: "insensitive" } },
        { products: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
      ] } : {},
    ],
  };
  const orderBy = { orderDate: OLDEST_FIRST.has(view) ? "asc" : "desc" } as const;
  if (view === "nodesign") {
    // open orders that no design file names yet
    const open = await prisma.embOrder.findMany({ where, orderBy });
    const have = new Set((await prisma.embDesignFile.findMany({
      where: { orderNumber: { in: open.map((o) => o.orderNumber) } }, select: { orderNumber: true },
    })).map((f) => f.orderNumber));
    const rows = open.filter((o) => !have.has(o.orderNumber));
    res.json({ status: "success", total: rows.length, pageSize: PAGE, orders: await withDesigns(rows.slice((page - 1) * PAGE, page * PAGE)) });
    return;
  }
  const [total, orders] = await Promise.all([
    prisma.embOrder.count({ where }),
    prisma.embOrder.findMany({ where, orderBy, skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  res.json({ status: "success", total, pageSize: PAGE, orders: await withDesigns(orders) });
}));

embroideryRouter.get("/meta", safe(async (_req, res) => {
  const [options, shops, todo, nolabel] = await Promise.all([
    prisma.embOption.findMany({ orderBy: [{ column: "asc" }, { position: "asc" }, { value: "asc" }] }),
    prisma.embOrder.findMany({ distinct: ["shopName"], select: { shopName: true }, orderBy: { shopName: "asc" } }),
    prisma.embOrder.count({ where: VIEW_WHERE.todo }),
    prisma.embOrder.count({ where: VIEW_WHERE.nolabel }),
  ]);
  res.json({
    status: "success", options,
    shops: shops.map((s) => s.shopName).filter(Boolean),
    counts: { todo, nolabel },
    // ShipStation has no direct order link; its order search by number is the closest.
    // The ship## host differs per account: SS_WEB_URL (e.g. https://ship11.shipstation.com).
    ssWebUrl: (process.env.SS_WEB_URL || "https://ship.shipstation.com").replace(/\/+$/, ""),
    sync: {
      shipstation: { configured: ssConfigured(), last: syncStatus() },
      dropbox: { configured: dbxConfigured(), last: dbxStatus() },
    },
  });
}));

const Patch = z.object({
  field: z.enum([...EMB_COLUMNS, "note"]),
  value: z.string().max(500).nullable(),
});
embroideryRouter.patch("/orders/:id", safe(async (req, res) => {
  const p = Patch.safeParse(req.body);
  if (!p.success) { res.status(400).json({ status: "error", message: "Invalid field" }); return; }
  const value = p.data.value?.trim() || null;
  const prev = await prisma.embOrder.findUnique({ where: { id: req.params.id }, select: { orderStatus: true, printStatus: true } });
  if (!prev) { res.status(404).json({ status: "error", message: "Order not found" }); return; }
  const data: Prisma.EmbOrderUpdateInput = { [p.data.field]: value };
  if (p.data.field === "printStatus") {
    Object.assign(data, value === "PRINTED" ? { printedAt: new Date(), printedBy: await userName(req.user!.id) } : { printedAt: null, printedBy: null });
  }
  // CANCELED is one state: set (or cleared) in order status or print status, the other follows
  const twin = p.data.field === "orderStatus" ? "printStatus" : p.data.field === "printStatus" ? "orderStatus" : null;
  if (twin) {
    if (value === CANCELED) {
      data[twin] = CANCELED;
      if (twin === "printStatus") Object.assign(data, { printedAt: null, printedBy: null });
    } else if (prev[p.data.field as "orderStatus" | "printStatus"] === CANCELED && prev[twin] === CANCELED) {
      data[twin] = null;
    }
  }
  const order = await prisma.embOrder.update({ where: { id: req.params.id }, data });
  res.json({ status: "success", order: (await withDesigns([order]))[0] });
}));

/** Packing-slip barcode → PRINTED. */
embroideryRouter.post("/scan", safe(async (req, res) => {
  const raw = String(req.body?.code ?? "").trim();
  // ShipStation's own "Scan to View" barcode ([Barcode] on a packing slip) reads ^#^<orderId>^
  const ss = raw.match(/^\^#\^(\d+)\^?$/);
  const code = ss ? ss[1] : raw.replace(/^#/, "");
  if (!code) { res.status(400).json({ status: "error", message: "Empty code" }); return; }
  // the barcode is the order number; ShipStation's own order id is accepted too
  const asId = /^\d{1,10}$/.test(code) && Number(code) <= 2147483647 ? [{ ssOrderId: Number(code) }] : [];
  const find = () => prisma.embOrder.findMany({ where: { OR: [{ orderNumber: code }, ...asId] } });
  let orders = await find();
  if (!orders.length) {
    // scanned before the next sync picked it up
    try { if (await fetchByOrderNumber(code)) orders = await find(); }
    catch (e) { console.warn("Embroidery scan lookup:", (e as Error).message); }
  }
  if (!orders.length) { res.json({ status: "success", result: "unknown", code }); return; }
  const o = orders[0];
  if (o.printStatus === "PRINTED") {
    res.json({ status: "success", result: "already", code, order: o });
    return;
  }
  const updated = await prisma.embOrder.update({
    where: { id: o.id }, data: { printStatus: "PRINTED", printedAt: new Date(), printedBy: await userName(req.user!.id) },
  });
  res.json({ status: "success", result: o.ssStatus === "cancelled" ? "cancelled" : "printed", code, order: updated });
}));

const Opt = z.object({ column: z.enum(EMB_COLUMNS), value: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
embroideryRouter.post("/options", safe(async (req, res) => {
  const p = Opt.safeParse(req.body);
  if (!p.success) { res.status(400).json({ status: "error", message: "Invalid option" }); return; }
  const position = await prisma.embOption.count({ where: { column: p.data.column } });
  const option = await prisma.embOption.upsert({
    where: { column_value: { column: p.data.column, value: p.data.value } },
    create: { ...p.data, position },
    update: p.data.color ? { color: p.data.color } : {},
  });
  res.json({ status: "success", option });
}));

embroideryRouter.patch("/options/:id", safe(async (req, res) => {
  const color = String(req.body?.color ?? "");
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) { res.status(400).json({ status: "error", message: "Invalid color" }); return; }
  await prisma.embOption.update({ where: { id: req.params.id }, data: { color } }).catch(() => null);
  res.json({ status: "success" });
}));

embroideryRouter.delete("/options/:id", safe(async (req, res) => {
  await prisma.embOption.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ status: "success" });
}));

embroideryRouter.post("/sync", safe(async (_req, res) => {
  await Promise.all([syncShipStation(), syncDropbox()]);
  res.json({ status: "success", shipstation: syncStatus(), dropbox: dbxStatus() });
}));

/** Opens a design file (auth via ?token=, so it works as a plain link). */
embroideryRouter.get("/design/:id", safe(async (req, res) => {
  const f = await prisma.embDesignFile.findUnique({ where: { id: req.params.id } });
  if (!f) { res.status(404).json({ status: "error", message: "File not found" }); return; }
  try {
    res.redirect(await temporaryLink(f.path));
  } catch (e) {
    res.status(502).json({ status: "error", message: (e as Error).message });
  }
}));

// ShipStation every 3 minutes, Dropbox every minute
let started = false;
export function startEmbroideryJobs() {
  if (started) return;
  started = true;
  setTimeout(() => { syncShipStation(); syncDropbox(); }, 8000).unref();
  setInterval(() => syncShipStation(), 3 * 60_000).unref();
  setInterval(() => syncDropbox(), 60_000).unref();
}
