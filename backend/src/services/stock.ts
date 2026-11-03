// Stock Inventory core. Every quantity change goes through here, inside a transaction:
// the level is changed by one conditional UPDATE (so two machines cannot take the last
// bottle, and stock never goes negative) and a StockMovement records before/after.
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { fetchFloorMachines } from "./dtfMonitor";
import { stockMessage, TelegramCfg, unitLabel, getTelegramCfg, formatQty } from "./stockTelegram";

type Tx = Prisma.TransactionClient;

export const UNITS = ["bottle", "roll", "pcs", "kg", "liter", "meter", "box"];
// DTF and UV are built in: a machine's Stock tab opens on the category of its type.
const MACHINE_CATEGORIES = ["DTF", "UV"];
const CATEGORY_KEY = "stockCategories";
const MAX_LEVEL = new Prisma.Decimal("99999999.99");
export const UNDO_MINUTES = 15;
const TX_OPTS = { timeout: 20000, maxWait: 10000 };

/** A rule violation the user should see. `code` lets the UI show it in its language. */
export class StockError extends Error {
  constructor(public code: string, message: string, public params: Record<string, string | number> = {}, public status = 400) {
    super(message);
  }
}

export interface Who { actor: string; machine?: string; source?: "web" | "agent" }

export function parseQty(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s) || Number(s) <= 0) {
    throw new StockError("invalid_quantity", "Enter a quantity above zero with at most two decimals.");
  }
  return Number(s).toFixed(2);
}

function checkNote(note: unknown, max = 255): string {
  const s = String(note ?? "").trim();
  if (s.length > max) throw new StockError("note_too_long", `Note can be at most ${max} characters.`, { max });
  return s;
}

export async function audit(actor: string, action: string, detail = "", tx: Tx | typeof prisma = prisma) {
  await tx.stockAudit.create({ data: { actor, action, detail: detail.slice(0, 500) } });
}

// ---- warehouses (mirrored from DTF Monitor) ----

let lastSync = 0;
let syncing: Promise<void> | null = null;

/** Pull warehouses + machines from DTF Monitor. New ones appear, ones removed there go
 *  inactive (their stock and history stay). */
export async function syncWarehouses(): Promise<void> {
  const floor = await fetchFloorMachines();
  const now = new Date();
  const names = new Set(floor.warehouses.filter(Boolean));
  for (const m of floor.machines) if (m.warehouse) names.add(m.warehouse);
  for (const name of names) {
    const machines = floor.machines.filter((m) => m.warehouse === name).map((m) => ({ name: m.name, type: m.type }));
    await prisma.stockWarehouse.upsert({
      where: { name },
      create: { name, machines, syncedAt: now },
      update: { active: true, machines, syncedAt: now },
    });
  }
  // An empty answer is a glitch, not "every warehouse was deleted".
  if (names.size) {
    await prisma.stockWarehouse.updateMany({ where: { name: { notIn: [...names] }, active: true }, data: { active: false } });
  }
  lastSync = Date.now();
}

/** Keeps the tab current without waiting for the periodic sync; a DTF Monitor outage
 *  must not take the stock tab down, so failures only leave the last known list. */
export async function syncIfStale(maxAgeMs = 60000): Promise<void> {
  if (!env.dtfMonitorUrl || !env.dtfMonitorApiKey || Date.now() - lastSync < maxAgeMs) return;
  syncing ??= syncWarehouses().catch((e) => { console.warn("Stock warehouse sync:", (e as Error).message); }).finally(() => { syncing = null; });
  await syncing;
}

/** The warehouse a machine reports. DTF Monitor is the authority, so an unknown name
 *  is a warehouse created moments ago rather than an error. */
export async function ensureWarehouse(name: string) {
  const n = name.trim();
  if (!n) throw new StockError("no_warehouse", "This machine has no warehouse assigned in DTF Monitor.");
  return prisma.stockWarehouse.upsert({ where: { name: n }, create: { name: n }, update: { active: true } });
}

async function activeWarehouse(tx: Tx | typeof prisma, id: number) {
  const w = await tx.stockWarehouse.findFirst({ where: { id, active: true } });
  if (!w) throw new StockError("inactive_warehouse", "Select an active warehouse.");
  return w;
}

// ---- level changes ----

async function changeLevel(tx: Tx, warehouseId: number, productId: number, type: "in" | "out", qty: string, unit: string) {
  await tx.$executeRaw`INSERT INTO "StockLevel" ("warehouseId", "productId", "quantity") VALUES (${warehouseId}, ${productId}, 0) ON CONFLICT DO NOTHING`;
  const rows = type === "out"
    ? await tx.$queryRaw<{ quantity: string }[]>`UPDATE "StockLevel" SET "quantity" = "quantity" - ${qty}::numeric
        WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} AND "quantity" >= ${qty}::numeric RETURNING "quantity"::text AS quantity`
    : await tx.$queryRaw<{ quantity: string }[]>`UPDATE "StockLevel" SET "quantity" = "quantity" + ${qty}::numeric
        WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} AND "quantity" + ${qty}::numeric <= ${MAX_LEVEL.toFixed(2)}::numeric RETURNING "quantity"::text AS quantity`;
  if (!rows.length) {
    if (type === "in") throw new StockError("stock_limit", "Stock limit exceeded.");
    const cur = await tx.stockLevel.findUnique({ where: { warehouseId_productId: { warehouseId, productId } } });
    const available = Number(cur?.quantity ?? 0);
    throw new StockError("insufficient_stock", `Not enough stock. Available: ${available} ${unit}.`, { available, unit });
  }
  const after = new Prisma.Decimal(rows[0].quantity);
  const before = type === "out" ? after.plus(qty) : after.minus(qty);
  return { before, after };
}

interface MoveInput {
  warehouse: { id: number; name: string };
  product: { id: number; name: string; unit: string; minStock: Prisma.Decimal };
  quantity: string;
  type: "in" | "out";
  kind: string;
  note: string;
  who: Who;
  batchKey?: string;
  tg: TelegramCfg | null;
}

async function recordMove(tx: Tx, m: MoveInput) {
  const { before, after } = await changeLevel(tx, m.warehouse.id, m.product.id, m.type, m.quantity, m.product.unit);
  const level = await tx.stockLevel.findUnique({ where: { warehouseId_productId: { warehouseId: m.warehouse.id, productId: m.product.id } } });
  const min = level?.minStock ?? m.product.minStock;
  const row = await tx.stockMovement.create({
    data: {
      warehouseId: m.warehouse.id, productId: m.product.id, type: m.type, kind: m.kind, quantity: m.quantity,
      before, after, note: m.note, actor: m.who.actor, machine: m.who.machine || "", source: m.who.source || "web",
      batchKey: m.batchKey ?? null,
    },
  });
  if (m.tg) {
    const unit = unitLabel(m.product.unit, m.tg.lang);
    if (level?.tracked !== false && before.gt(min) && after.lte(min)) {
      await tx.stockNotification.create({
        data: { eventKey: `critical:${row.id}`, message: stockMessage(m.tg.lang, "critical", { warehouse: m.warehouse.name, product: m.product.name, qty: formatQty(after), unit }) },
      });
    }
    if (m.kind === "consumption") {
      const when = DateTime.now().setZone(env.defaultTimezone).toFormat("MM/dd/yyyy HH:mm");
      await tx.stockNotification.create({
        data: {
          eventKey: `consumption:${row.id}`,
          message: stockMessage(m.tg.lang, "consumption", {
            when, warehouse: m.warehouse.name, product: m.product.name, qty: m.quantity.replace(/\.?0+$/, ""), unit, left: formatQty(after),
            actor: m.who.actor, machine: m.who.machine || "",
          }),
        },
      });
    }
  }
  return row;
}

// ---- operations ----

export interface BatchInput {
  warehouseId: number;
  type: "in" | "out";
  items: { productId: number; quantity: unknown }[];
  note?: unknown;
  requestKey: string;
  who: Who;
}

/** A whole list in one transaction: all lines apply or none do. The same requestKey
 *  never applies twice, so retries are safe. Returns false if it was already applied. */
export async function applyBatch(input: BatchInput): Promise<boolean> {
  if (!input.items.length || input.items.length > 100) throw new StockError("invalid_items", "Select 1–100 products.");
  if (input.type !== "in" && input.type !== "out") throw new StockError("invalid_request", "Invalid operation.");
  const note = checkNote(input.note);
  const lines = input.items.map((i) => ({ productId: Number(i.productId), quantity: parseQty(i.quantity) }))
    .sort((a, b) => a.productId - b.productId);   // same lock order for every list: no deadlocks
  if (lines.some((l, i) => !Number.isInteger(l.productId) || (i > 0 && lines[i - 1].productId === l.productId))) {
    throw new StockError("invalid_items", "Invalid product list.");
  }
  const hash = crypto.createHash("sha256").update(JSON.stringify([input.warehouseId, input.type, lines, note])).digest("hex");
  const tg = await getTelegramCfg(true);

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.$executeRaw`INSERT INTO "StockBatch" ("requestKey", "payloadHash") VALUES (${input.requestKey}, ${hash}) ON CONFLICT DO NOTHING`;
    if (!fresh) {
      const prev = await tx.stockBatch.findUnique({ where: { requestKey: input.requestKey } });
      if (prev?.payloadHash !== hash) throw new StockError("request_reused", "This request id was used for a different list. Reload and try again.", {}, 409);
      return false;
    }
    const warehouse = await activeWarehouse(tx, input.warehouseId);
    for (const l of lines) {
      const product = await tx.stockProduct.findFirst({ where: { id: l.productId, active: true } });
      if (!product) throw new StockError("inactive_product", "Select an active product.");
      await recordMove(tx, {
        warehouse, product, quantity: l.quantity, type: input.type, kind: input.type === "out" ? "consumption" : "stock",
        note, who: input.who, batchKey: input.requestKey, tg,
      });
    }
    await audit(input.who.actor, `stock.${input.type}`, `${warehouse.name} / ${lines.length} item(s)${input.who.machine ? ` / ${input.who.machine}` : ""}`, tx);
    return true;
  }, TX_OPTS);
}

export async function transferStock(sourceId: number, destId: number, productId: number, quantity: unknown, note: unknown, who: Who) {
  const qty = parseQty(quantity);
  const text = checkNote(note, 160);
  if (sourceId === destId) throw new StockError("same_warehouse", "Source and destination must be different.");
  const tg = await getTelegramCfg(true);
  await prisma.$transaction(async (tx) => {
    const source = await activeWarehouse(tx, sourceId);
    const dest = await activeWarehouse(tx, destId);
    const product = await tx.stockProduct.findFirst({ where: { id: productId, active: true } });
    if (!product) throw new StockError("inactive_product", "Select an active product.");
    const description = `${source.name} → ${dest.name}${text ? ` · ${text}` : ""}`.slice(0, 255);
    const legs = [{ warehouse: source, type: "out" as const }, { warehouse: dest, type: "in" as const }]
      .sort((a, b) => a.warehouse.id - b.warehouse.id);   // fixed lock order, whichever way the transfer goes
    for (const leg of legs) {
      await recordMove(tx, { ...leg, product, quantity: qty, kind: "transfer", note: description, who, tg });
    }
    await audit(who.actor, "stock.transfer", `${description} / ${product.name} / ${qty}`, tx);
  }, TX_OPTS);
}

async function reverseOne(tx: Tx, id: number, who: Who, tg: TelegramCfg | null) {
  const claimed = await tx.stockMovement.updateMany({ where: { id, kind: { in: ["consumption", "stock"] }, reversedAt: null }, data: { reversedAt: new Date() } });
  if (!claimed.count) throw new StockError("not_reversible", "Record not found or already reversed.", {}, 404);
  const m = await tx.stockMovement.findUniqueOrThrow({ where: { id }, include: { product: true, warehouse: true } });
  // Used goods go back in; a wrong stock entry comes out again (refused if it is already gone).
  const type = m.kind === "stock" ? "out" : "in";
  const { before, after } = await changeLevel(tx, m.warehouseId, m.productId, type, m.quantity.toFixed(2), m.product.unit);
  await tx.stockMovement.create({
    data: {
      warehouseId: m.warehouseId, productId: m.productId, type, kind: "reversal", quantity: m.quantity, before, after,
      note: `Reversal of #${id}`, actor: who.actor, machine: who.machine || "", source: who.source || "web",
    },
  });
  if (tg && m.kind === "consumption") {
    await tx.stockNotification.create({
      data: {
        eventKey: `reversal:${id}`,
        message: stockMessage(tg.lang, "reversal", {
          warehouse: m.warehouse.name, product: m.product.name, qty: formatQty(m.quantity), unit: unitLabel(m.product.unit, tg.lang), left: formatQty(after), actor: who.actor,
        }),
      },
    });
  }
}

/** Manager's reversal of one usage or stock-in record. */
export async function reverseMovement(id: number, who: Who) {
  const tg = await getTelegramCfg(true);
  await prisma.$transaction(async (tx) => {
    await reverseOne(tx, id, who, tg);
    await audit(who.actor, "movement.reverse", `#${id}`, tx);
  }, TX_OPTS);
}

/** Set a level to what is really on the shelf. The difference is a correction, so it never
 *  counts as usage and stays out of the consumption reports. */
export async function adjustStock(warehouseId: number, productId: number, count: unknown, note: unknown, who: Who) {
  const raw = String(count ?? "").trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) throw new StockError("invalid_quantity", "Enter a quantity with at most two decimals.");
  const target = new Prisma.Decimal(raw);
  const text = checkNote(note);
  const tg = await getTelegramCfg(true);
  await prisma.$transaction(async (tx) => {
    const warehouse = await activeWarehouse(tx, warehouseId);
    const product = await tx.stockProduct.findFirst({ where: { id: productId, active: true } });
    if (!product) throw new StockError("inactive_product", "Select an active product.");
    await tx.$executeRaw`INSERT INTO "StockLevel" ("warehouseId", "productId", "quantity") VALUES (${warehouseId}, ${productId}, 0) ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<{ quantity: string }[]>`SELECT "quantity"::text AS quantity FROM "StockLevel" WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} FOR UPDATE`;
    const delta = target.minus(rows[0].quantity);
    if (delta.isZero()) throw new StockError("no_change", "The quantity is already the same.");
    await recordMove(tx, {
      warehouse, product, quantity: delta.abs().toFixed(2), type: delta.isPositive() ? "in" : "out",
      kind: "adjustment", note: text, who, tg,
    });
    await audit(who.actor, "stock.adjust", `${warehouse.name} / ${product.name} / ${rows[0].quantity} → ${target.toFixed(2)}`, tx);
  }, TX_OPTS);
}

/** The agent's Undo: a machine takes back its own list for a few minutes after a mis-tap. */
export async function undoBatch(requestKey: string, machine: string, who: Who): Promise<number> {
  const moves = await prisma.stockMovement.findMany({ where: { batchKey: requestKey, machine, kind: "consumption" } });
  if (!moves.length) throw new StockError("not_reversible", "Record not found or already reversed.", {}, 404);
  const open = moves.filter((m) => !m.reversedAt);
  if (!open.length) return 0;  // already undone (a re-sent Undo)
  const limit = Date.now() - UNDO_MINUTES * 60000;
  if (open.some((m) => m.createdAt.getTime() < limit)) {
    throw new StockError("undo_expired", `Undo is only possible for ${UNDO_MINUTES} minutes. Ask a manager to reverse it.`, { minutes: UNDO_MINUTES }, 409);
  }
  const tg = await getTelegramCfg(true);
  await prisma.$transaction(async (tx) => {
    for (const m of open) await reverseOne(tx, m.id, who, tg);
    await audit(who.actor, "consumption.undo", `${machine} / ${open.length} item(s)`, tx);
  }, TX_OPTS);
  return open.length;
}

/** Per warehouse: its own threshold (null = the product's) and whether it keeps the product at all. */
export async function setWarehouseMins(productId: number, mins: Record<string, string | null>, tracked: Record<string, boolean>, actor: string) {
  await prisma.$transaction(async (tx) => {
    for (const id of new Set([...Object.keys(mins), ...Object.keys(tracked)])) {
      const warehouseId = Number(id);
      const data = { ...(id in mins ? { minStock: mins[id] } : {}), ...(id in tracked ? { tracked: tracked[id] } : {}) };
      await tx.stockLevel.upsert({
        where: { warehouseId_productId: { warehouseId, productId } },
        create: { warehouseId, productId, ...data },
        update: data,
      });
    }
    await audit(actor, "product.mins", `#${productId}`, tx);
  }, TX_OPTS);
}

/** Delete a product. Stock must be at zero first. Without movements it is really deleted;
 *  with movements it only leaves the lists, because reports and history point at it. */
export async function deleteProduct(id: number, actor: string): Promise<"deleted" | "archived"> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.stockProduct.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new StockError("not_found", "Product not found.", {}, 404);
    const stock = await tx.stockLevel.aggregate({ where: { productId: id }, _sum: { quantity: true } });
    const left = Number(stock._sum.quantity ?? 0);
    if (left > 0) throw new StockError("product_has_stock", `${left} still in stock. Bring it to zero first.`, { quantity: left });
    const history = await tx.stockMovement.count({ where: { productId: id } });
    if (history) {
      await tx.stockProduct.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
    } else {
      await tx.stockLevel.deleteMany({ where: { productId: id } });
      await tx.stockProduct.delete({ where: { id } });
    }
    await audit(actor, "product.delete", `#${id} ${p.name}`, tx);
    return history ? "archived" : "deleted";
  }, TX_OPTS);
}

// ---- categories ----

export async function listCategories(): Promise<string[]> {
  const row = await prisma.appConfig.findUnique({ where: { key: CATEGORY_KEY } });
  return (row?.value as string[] | undefined) ?? MACHINE_CATEGORIES;
}

async function saveCategories(tx: Tx, value: string[]) {
  await tx.appConfig.upsert({ where: { key: CATEGORY_KEY }, create: { key: CATEGORY_KEY, value }, update: { value } });
}

function cleanCategory(name: unknown): string {
  const n = String(name ?? "").trim();
  if (!n || n.length > 40) throw new StockError("invalid_category", "Enter a category name of up to 40 characters.");
  return n;
}

function assertFree(all: string[], name: string, except = "") {
  const taken = all.find((c) => c.toLowerCase() === name.toLowerCase() && c !== except);
  if (taken) throw new StockError("category_exists", "This category already exists.");
}

export async function addCategory(name: unknown, actor: string) {
  const n = cleanCategory(name);
  const all = await listCategories();
  assertFree(all, n);
  await prisma.$transaction(async (tx) => {
    await saveCategories(tx, [...all, n]);
    await audit(actor, "category.add", n, tx);
  });
}

export async function renameCategory(from: string, to: unknown, actor: string) {
  const n = cleanCategory(to);
  const all = await listCategories();
  if (!all.includes(from)) throw new StockError("not_found", "Category not found.", {}, 404);
  if (MACHINE_CATEGORIES.includes(from)) throw new StockError("category_locked", "DTF and UV are tied to the machine types, so they cannot change.");
  assertFree(all, n, from);
  await prisma.$transaction(async (tx) => {
    await tx.stockProduct.updateMany({ where: { category: from }, data: { category: n } });
    await saveCategories(tx, all.map((c) => (c === from ? n : c)));
    await audit(actor, "category.rename", `${from} → ${n}`, tx);
  });
}

export async function deleteCategory(name: string, actor: string) {
  const all = await listCategories();
  if (MACHINE_CATEGORIES.includes(name)) throw new StockError("category_locked", "DTF and UV are tied to the machine types, so they cannot change.");
  const used = await prisma.stockProduct.count({ where: { category: name, deletedAt: null } });
  if (used) throw new StockError("category_in_use", `${used} product(s) use this category.`, { count: used });
  await prisma.$transaction(async (tx) => {
    await saveCategories(tx, all.filter((c) => c !== name));
    await audit(actor, "category.delete", name, tx);
  });
}

// ---- reads ----

export function stockStatus(qty: number, min: number): "out" | "low" | "ok" {
  return qty <= 0 ? "out" : qty <= min ? "low" : "ok";
}

export async function inventory(warehouseId: number) {
  const products = await prisma.stockProduct.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { levels: { where: { warehouseId } } },
  });
  // A product this warehouse doesn't keep stays out of the lists unless stock was put there anyway.
  return products.filter((p) => p.levels[0]?.tracked !== false || Number(p.levels[0]?.quantity ?? 0) > 0).map((p) => {
    const quantity = Number(p.levels[0]?.quantity ?? 0);
    const minStock = Number(p.levels[0]?.minStock ?? p.minStock);
    return { id: p.id, name: p.name, category: p.category, unit: p.unit, minStock, quantity, status: stockStatus(quantity, minStock) };
  });
}

export async function overview() {
  const warehouses = await prisma.stockWarehouse.findMany({
    where: { OR: [{ active: true }, { levels: { some: { quantity: { gt: 0 } } } }] },
    orderBy: { name: "asc" },
  });
  const products = await prisma.stockProduct.findMany({
    where: { active: true }, orderBy: [{ category: "asc" }, { name: "asc" }], include: { levels: true },
  });
  const critical: { warehouse: string; product: string; quantity: number; minStock: number; unit: string; status: string }[] = [];
  const rows = products.map((p) => {
    const levels: Record<number, number> = {};
    const mins: Record<number, number> = {};   // only the warehouses with their own threshold
    const untracked: number[] = [];            // warehouses that don't keep this product
    for (const l of p.levels) {
      levels[l.warehouseId] = Number(l.quantity);
      if (l.minStock !== null) mins[l.warehouseId] = Number(l.minStock);
      if (!l.tracked) untracked.push(l.warehouseId);
    }
    const minStock = Number(p.minStock);
    for (const w of warehouses) {
      if (!w.active || untracked.includes(w.id)) continue;
      const q = levels[w.id] ?? 0;
      const min = mins[w.id] ?? minStock;
      const status = stockStatus(q, min);
      if (status !== "ok") critical.push({ warehouse: w.name, product: p.name, quantity: q, minStock: min, unit: p.unit, status });
    }
    return {
      id: p.id, name: p.name, category: p.category, unit: p.unit, minStock, levels, mins, untracked,
      total: Object.values(levels).reduce((a, b) => a + b, 0),
    };
  });
  const zone = env.defaultTimezone;
  const today = DateTime.now().setZone(zone).startOf("day");
  const used = await prisma.stockMovement.groupBy({
    by: ["warehouseId"], where: { kind: "consumption", reversedAt: null, createdAt: { gte: today.toJSDate() } }, _count: true,
  });
  // Last 7 Texas days, per warehouse, so the tab can show one warehouse or all of them.
  const since = today.minus({ days: 6 });
  const moves = await prisma.$queryRaw<{ warehouseId: number; day: string; type: string; n: bigint }[]>`
    SELECT "warehouseId", to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zone}::text, 'YYYY-MM-DD') AS day, "type", COUNT(*) AS n
    FROM "StockMovement"
    WHERE "kind" <> 'reversal' AND "reversedAt" IS NULL AND "createdAt" >= ${since.toUTC().toFormat("yyyy-MM-dd HH:mm:ss")}::timestamp
    GROUP BY 1, 2, 3`;
  return {
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, active: w.active, machines: w.machines ?? [] })),
    products: rows, critical,
    usedToday: Object.fromEntries(used.map((u) => [u.warehouseId, u._count])),
    weekly: {
      days: Array.from({ length: 7 }, (_, i) => since.plus({ days: i }).toFormat("yyyy-MM-dd")),
      rows: moves.map((m) => ({ warehouseId: m.warehouseId, day: m.day, type: m.type, n: Number(m.n) })),
    },
  };
}

export function dateBounds(from: string, to: string) {
  const zone = env.defaultTimezone;
  const a = DateTime.fromISO(from, { zone }).startOf("day");
  const b = DateTime.fromISO(to, { zone }).startOf("day");
  if (!a.isValid || !b.isValid) throw new StockError("invalid_date", "Select valid dates.");
  if (a > b) throw new StockError("invalid_date", "The start date cannot be after the end date.");
  return { gte: a.toJSDate(), lt: b.plus({ days: 1 }).toJSDate() };
}
