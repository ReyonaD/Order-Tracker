import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import multer from "multer";
import { env } from "../env";
import { requireAuth } from "../middleware/auth";
import { loadPermissions, COLUMN_BY_FIELD } from "../config/permissions";

// Today's [start, end) in the business timezone — for the "Today 5 PM" view.
function todayRange(): { gte: Date; lt: Date } {
  const start = DateTime.now().setZone(env.defaultTimezone).startOf("day");
  return { gte: start.toJSDate(), lt: start.plus({ days: 1 }).toJSDate() };
}

export const orderRouter = Router();

orderRouter.use(requireAuth);

// Include store info + image metadata (never the image bytes) with orders.
const storeInclude = {
  store: { select: { code: true, name: true, color: true } },
  image: { select: { id: true, filename: true, mimeType: true, updatedAt: true } },
};

// In-memory upload, images only, 10 MB max.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// Named views = the AppSheet "slices". Each returns a Prisma where fragment.
// Extra filters (store/status/search/...) are AND-combined with the view.
const FORT_WORTH_STORES = ["CHEETAH", "GANGROLL"];
// Stores whose pickups are handled at the "Outside" satellite locations.
const OUTSIDE_PICKUP_STORES = ["INDIANA", "MUSICCITY", "BOSTONIAN", "WESTCOAST", "LUISVILLE", "MISSOURI"];
// Houston Production: PROMO orders whose pickup location is Houston.
const HOUSTON_WHERE: Prisma.OrderWhereInput = {
  storeCode: "PROMO",
  shippingMethod: { contains: "Houston", mode: "insensitive" },
};
// Mesquite Production: PROMO orders whose pickup location is Mesquite.
const MESQUITE_WHERE: Prisma.OrderWhereInput = {
  storeCode: "PROMO",
  shippingMethod: { contains: "Mesquite", mode: "insensitive" },
};

function viewWhere(view: string): Prisma.OrderWhereInput {
  switch (view) {
    // Fort Worth (Cheetah) Production: ALL CHEETAH + GANGROLL orders (pickup & shipping).
    case "fortworth":
      return { storeCode: { in: FORT_WORTH_STORES } };
    // Houston Production: PROMO orders picked up in Houston.
    case "houston":
      return HOUSTON_WHERE;
    // Mesquite Production: PROMO orders picked up in Mesquite.
    case "mesquite":
      return MESQUITE_WHERE;
    // Richardson Production: everything except Fort Worth, Houston and Mesquite.
    case "richardson":
      return {
        storeCode: { notIn: FORT_WORTH_STORES },
        AND: [{ NOT: HOUSTON_WHERE }, { NOT: MESQUITE_WHERE }],
      };
    // "Today 5 PM": deadline falls on today (not tomorrow), excluding cancelled.
    case "deadline5":
      return { status: { not: "CANCELLED" }, deadlineAt: todayRange() };
    // Problem uploads.
    case "problemli":
      return { uploadStatus: { contains: "Problem", mode: "insensitive" } };
    // Not yet printed (printStatus is null/"Not Printed"/anything except "Printed") and
    // not cancelled. The explicit null branch is required: SQL `printStatus <> 'Printed'`
    // is UNKNOWN for null rows, which would wrongly drop brand-new unprinted orders.
    case "notprinted":
      return {
        status: { not: "CANCELLED" },
        OR: [{ printStatus: null }, { printStatus: { not: "Printed" } }],
      };
    // Outside Pick-up: pickups at the satellite stores.
    case "outsidepickup":
      return { storeCode: { in: OUTSIDE_PICKUP_STORES }, isPickup: true };
    default:
      return {};
  }
}

// Base filters shared by the list and the facet panel (everything EXCEPT the
// month/pickup drill-down, which the facet panel itself breaks down).
interface BaseParams {
  view?: string;
  store?: string;
  status?: "NEW" | "FULFILLED" | "CANCELLED";
  search?: string;
  designer?: string;
  machinist?: string;
  urgent?: "true" | "false";
}
function baseFilters(p: BaseParams): Prisma.OrderWhereInput[] {
  const filters: Prisma.OrderWhereInput[] = [];
  if (p.view) filters.push(viewWhere(p.view));
  if (p.store) filters.push({ storeCode: p.store.toUpperCase() });
  if (p.status) filters.push({ status: p.status });
  if (p.designer) filters.push({ designerName: p.designer });
  if (p.machinist) filters.push({ machinistName: p.machinist });
  if (p.urgent) filters.push({ urgent: p.urgent === "true" });
  if (p.search) {
    filters.push({
      OR: [
        { orderName: { contains: p.search, mode: "insensitive" } },
        { shopifyOrderId: { contains: p.search } },
        { trackingNumber: { contains: p.search, mode: "insensitive" } },
      ],
    });
  }
  return filters;
}

// "YYYY-MM" -> a [gte, lt) month range filter (UTC boundaries).
function monthFilter(month: string): Prisma.OrderWhereInput | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return { orderDate: { gte: new Date(Date.UTC(y, mo - 1, 1)), lt: new Date(Date.UTC(y, mo, 1)) } };
}

// "YYYY-MM-DD" -> a single-day [gte, lt) range filter (UTC).
function dayFilter(day: string): Prisma.OrderWhereInput | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return { orderDate: { gte: new Date(Date.UTC(y, mo - 1, d)), lt: new Date(Date.UTC(y, mo - 1, d + 1)) } };
}

// --- Facet panel: Month -> Day -> group (store or pickup/shipping) counts ---
// `by=store` breaks each day down by store; `by=pickup` by Pickup/Shipping.
const facetQuery = z.object({
  view: z.string().optional(),
  store: z.string().optional(),
  status: z.enum(["NEW", "FULFILLED", "CANCELLED"]).optional(),
  search: z.string().optional(),
  designer: z.string().optional(),
  machinist: z.string().optional(),
  urgent: z.enum(["true", "false"]).optional(),
  by: z.enum(["store", "pickup"]).default("store"),
});

orderRouter.get("/facets", async (req, res) => {
  const parsed = facetQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid query" });
    return;
  }
  const { by } = parsed.data;
  const filters = baseFilters(parsed.data);
  const where: Prisma.OrderWhereInput = filters.length ? { AND: filters } : {};

  const rows = await prisma.order.findMany({
    where,
    select: { orderDate: true, isPickup: true, storeCode: true },
  });

  // month -> { total, days: day -> { total, groups: key -> count } }
  const months = new Map<string, { total: number; days: Map<string, { total: number; groups: Map<string, number> }> }>();
  for (const r of rows) {
    const iso = r.orderDate.toISOString();
    const month = iso.slice(0, 7);
    const day = iso.slice(0, 10);
    const key = by === "pickup" ? (r.isPickup ? "Pickup" : "Shipping") : r.storeCode;

    let m = months.get(month);
    if (!m) { m = { total: 0, days: new Map() }; months.set(month, m); }
    m.total++;
    let d = m.days.get(day);
    if (!d) { d = { total: 0, groups: new Map() }; m.days.set(day, d); }
    d.total++;
    d.groups.set(key, (d.groups.get(key) || 0) + 1);
  }

  const result = [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, m]) => ({
      month,
      total: m.total,
      days: [...m.days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, d]) => ({
          day,
          total: d.total,
          groups: [...d.groups.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([key, count]) => ({ key, count })),
        })),
    }));

  res.json({ status: "success", total: rows.length, by, months: result });
});

// Ad-hoc column filters (the "Filters" popover). Each filter targets a column.
// String columns match case-insensitively; `status` is an enum (exact).
const FILTERABLE: Record<string, { field: string; kind: "str" | "arr" | "bool" | "enum"; nullable?: boolean }> = {
  store: { field: "storeCode", kind: "str" },
  shipping: { field: "displayShippingMethod", kind: "str" },
  item: { field: "itemTypes", kind: "arr" },
  designer: { field: "designerName", kind: "str", nullable: true },
  upload: { field: "uploadStatus", kind: "str", nullable: true },
  print: { field: "printStatus", kind: "str", nullable: true },
  machinist: { field: "machinistName", kind: "str", nullable: true },
  machine: { field: "machineName", kind: "str", nullable: true },
  status: { field: "status", kind: "enum" },
  urgent: { field: "urgent", kind: "bool" },
};

const I = "insensitive" as const;

function buildColumnFilter(f: { col: string; op: string; value: string }): Prisma.OrderWhereInput | null {
  const meta = FILTERABLE[f.col];
  if (!meta) return null;
  const { field, kind, nullable } = meta;
  const v = f.value;

  if (kind === "bool") {
    const b = v === "true";
    return f.op === "isnot" ? { [field]: { not: b } } : { [field]: b };
  }
  if (kind === "enum") {
    return f.op === "isnot" ? { [field]: { not: v } } : { [field]: v };
  }
  if (kind === "arr") {
    if (f.op === "isnot") return { NOT: { [field]: { has: v } } };
    return { [field]: { has: v } };
  }
  // string columns — case-insensitive
  if (f.op === "contains") return { [field]: { contains: v, mode: I } };
  if (f.op === "isnot") {
    const notCond = { [field]: { not: v, mode: I } };
    // Include null rows only for nullable columns (Prisma rejects `null` on required ones).
    return nullable ? { OR: [{ [field]: null }, notCond] } : notCond;
  }
  return { [field]: { equals: v, mode: I } };
}

// --- List orders with filtering / pagination ---
const listQuery = z.object({
  view: z.string().optional(),
  store: z.string().optional(),
  status: z.enum(["NEW", "FULFILLED", "CANCELLED"]).optional(),
  search: z.string().optional(),
  designer: z.string().optional(),
  machinist: z.string().optional(),
  urgent: z.enum(["true", "false"]).optional(),
  month: z.string().optional(),
  day: z.string().optional(),
  pickup: z.enum(["true", "false"]).optional(),
  filters: z.string().optional(), // JSON array of { col, op, value }
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
});

orderRouter.get("/", async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid query" });
    return;
  }
  const { month, day, pickup, page, pageSize } = parsed.data;

  const filters = baseFilters(parsed.data);
  if (day) {
    const df = dayFilter(day);
    if (df) filters.push(df);
  } else if (month) {
    const mf = monthFilter(month);
    if (mf) filters.push(mf);
  }
  if (pickup) filters.push({ isPickup: pickup === "true" });

  // Ad-hoc column filters.
  if (parsed.data.filters) {
    try {
      const arr = JSON.parse(parsed.data.filters) as { col: string; op: string; value: string }[];
      for (const f of Array.isArray(arr) ? arr : []) {
        if (!f || !f.col || f.value === undefined || f.value === "") continue;
        const cond = buildColumnFilter(f);
        if (cond) filters.push(cond);
      }
    } catch {
      /* ignore malformed filters */
    }
  }

  const where: Prisma.OrderWhereInput = filters.length ? { AND: filters } : {};

  try {
    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { orderDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: storeInclude,
      }),
    ]);
    res.json({ status: "success", total, page, pageSize, orders });
  } catch (err) {
    // A bad filter combination must not crash the server.
    console.error("[orders] query failed:", err instanceof Error ? err.message : err);
    res.status(400).json({ status: "error", message: "Invalid filter/query" });
  }
});

// --- Get one order ---
orderRouter.get("/:id", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: storeInclude,
  });
  if (!order) {
    res.status(404).json({ status: "error", message: "Order not found" });
    return;
  }
  res.json({ status: "success", order });
});

// --- Update workflow columns (role-gated) ---
// Designer owns columns G,H,I,K; Machinist owns J,L,M; Admin owns everything.
const updateSchema = z.object({
  designerName: z.string().nullable().optional(), // G
  uploadStatus: z.string().nullable().optional(), // H
  problemEmailSent: z.boolean().optional(),       // H (email sent flag)
  fileLink: z.string().nullable().optional(),     // I
  designerNote: z.string().nullable().optional(), // K
  printStatus: z.string().nullable().optional(),  // J
  machinistName: z.string().nullable().optional(),// L
  machineName: z.string().nullable().optional(),  // M
  urgent: z.boolean().optional(),                 // urgent (any non-viewer role)
  status: z.enum(["NEW", "FULFILLED", "CANCELLED"]).optional(), // P (admin override)
});

orderRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  const role = req.user!.role;

  // ADMIN edits everything; other roles are gated by the configurable permission matrix.
  const perms = role === "ADMIN" ? null : (await loadPermissions())[role];

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    const column = COLUMN_BY_FIELD[key];
    const allowed = role === "ADMIN" || (!!column && perms?.[column]?.edit === true);
    if (allowed) data[key] = value;
  }

  if (Object.keys(data).length === 0) {
    res.status(403).json({ status: "error", message: "No editable fields for your role" });
    return;
  }

  try {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data,
      include: storeInclude,
    });
    res.json({ status: "success", order });
  } catch {
    res.status(404).json({ status: "error", message: "Order not found" });
  }
});

// --- Image column: upload / view / delete ---
async function canEditImage(role: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  const perms = (await loadPermissions())[role];
  return perms?.image?.edit === true;
}

// Upload (or replace) the order's image. Multipart field name: "file".
orderRouter.post(
  "/:id/image",
  (req, res, next) =>
    upload.single("file")(req, res, (err: unknown) => {
      if (err) { res.status(400).json({ status: "error", message: err instanceof Error ? err.message : "Upload error" }); return; }
      next();
    }),
  async (req, res) => {
    if (!(await canEditImage(req.user!.role))) {
      res.status(403).json({ status: "error", message: "Not allowed to edit images" });
      return;
    }
    const file = req.file;
    if (!file) { res.status(400).json({ status: "error", message: "No image file (PNG/JPEG)" }); return; }
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!order) { res.status(404).json({ status: "error", message: "Order not found" }); return; }

    const image = await prisma.orderImage.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, filename: file.originalname, mimeType: file.mimetype, data: file.buffer },
      update: { filename: file.originalname, mimeType: file.mimetype, data: file.buffer },
      select: { id: true, filename: true, mimeType: true, updatedAt: true },
    });
    res.json({ status: "success", image });
  }
);

// View the image bytes (auth via header or ?token=, so <img> tags work).
orderRouter.get("/:id/image", async (req, res) => {
  const img = await prisma.orderImage.findUnique({ where: { orderId: req.params.id } });
  if (!img) { res.status(404).json({ status: "error", message: "No image" }); return; }
  res.setHeader("Content-Type", img.mimeType);
  res.setHeader("Cache-Control", "private, max-age=60");
  res.send(Buffer.from(img.data));
});

orderRouter.delete("/:id/image", async (req, res) => {
  if (!(await canEditImage(req.user!.role))) {
    res.status(403).json({ status: "error", message: "Not allowed to edit images" });
    return;
  }
  await prisma.orderImage.deleteMany({ where: { orderId: req.params.id } });
  res.json({ status: "success" });
});
