import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { requireAuth, requireSheets } from "../middleware/auth";
import { CURATED_ORDER, WAREHOUSES, SPLIT_WAREHOUSES, BASE_WAREHOUSE, defForKey, orderCategoryMeasures } from "../services/sheetCategories";
import { fetchWarehouseSplit } from "../services/dtfMonitor";

export const sheetRouter = Router();
sheetRouter.use(requireAuth, requireSheets);

const orderIndex = (key: string) => {
  const i = CURATED_ORDER.indexOf(key);
  return i < 0 ? CURATED_ORDER.length : i;
};

function listMonths(from: string, to: string, zone: string): string[] {
  let d = DateTime.fromISO(`${from}-01`, { zone }).startOf("month");
  const end = DateTime.fromISO(`${to}-01`, { zone }).startOf("month");
  const out: string[] = [];
  let guard = 0;
  while (d <= end && guard++ < 120) { out.push(d.toFormat("yyyy-MM")); d = d.plus({ months: 1 }); }
  return out;
}

// GET /sheets/summary?month=YYYY-MM
sheetRouter.get("/summary", async (req, res) => {
  try {
    const zone = env.defaultTimezone;
    const q = req.query as Record<string, string | undefined>;
    const now = DateTime.now().setZone(zone).toFormat("yyyy-MM");
    const from = q.from || q.month || now;
    const to = q.to || q.month || from;
    const f0 = DateTime.fromISO(`${from}-01`, { zone });
    const t0 = DateTime.fromISO(`${to}-01`, { zone });
    if (!f0.isValid || !t0.isValid || t0 < f0) { res.status(400).json({ status: "error", message: "Invalid range" }); return; }
    const months = listMonths(from, to, zone);
    const editable = months.length === 1; // only single-month view can be edited
    const rangeStart = f0.startOf("month").toJSDate();
    const rangeEnd = t0.startOf("month").plus({ months: 1 }).toJSDate();

    const stores = await prisma.store.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { code: true, name: true } });

    // auto value per month per store per category key
    const orders = await prisma.order.findMany({
      where: { orderDate: { gte: rangeStart, lt: rangeEnd }, status: { not: "CANCELLED" } },
      select: { storeCode: true, orderDate: true, lineItems: true },
    });
    const defs = new Map<string, ReturnType<typeof defForKey>>();
    const auto = new Map<string, Map<string, Record<string, number>>>(); // month -> store -> key -> value
    for (const o of orders) {
      const mm = DateTime.fromJSDate(o.orderDate).setZone(zone).toFormat("yyyy-MM");
      const bym = auto.get(mm) || new Map<string, Record<string, number>>();
      const a = bym.get(o.storeCode) || {};
      for (const [key, v] of Object.entries(orderCategoryMeasures(o.lineItems))) {
        defs.set(key, v.def);
        a[key] = (a[key] || 0) + (v.def.kind === "inches" ? v.inches : v.units);
      }
      bym.set(o.storeCode, a); auto.set(mm, bym);
    }
    const autoVal = (m: string, store: string, key: string) => auto.get(m)?.get(store)?.[key] || 0;

    const entries = await prisma.sheetEntry.findMany({ where: { month: { in: months } } });
    type Entry = { splitPct: Record<string, number> | null; totalOverride: number | null; baseline: number | null };
    const entryMap = new Map<string, Entry>(); // month|store|key
    const keysWithEntry = new Set<string>();
    for (const e of entries) {
      const sp = (e.splitPct as Record<string, number> | null) ?? null;
      entryMap.set(`${e.month}|${e.storeCode}|${e.type}`, { splitPct: sp, totalOverride: e.totalOverride, baseline: e.baseline });
      if (e.totalOverride != null || e.splitPct != null || e.baseline != null) { keysWithEntry.add(e.type); if (!defs.has(e.type)) defs.set(e.type, defForKey(e.type)); }
    }

    const round = (n: number) => Math.round(n * 10) / 10;
    const splitWhWithData = new Set<string>();
    // aggregate a cell across the month range (single month = passthrough+editable)
    function computeCell(store: string, key: string, split: boolean) {
      let total = 0; const wh: Record<string, number> = {};
      for (const m of months) {
        const e = entryMap.get(`${m}|${store}|${key}`) || null;
        // effective month total = (override, else auto) + additive baseline
        const mt = (e?.totalOverride != null ? e.totalOverride : autoVal(m, store, key)) + (e?.baseline ?? 0);
        if (mt <= 0) continue;
        total += mt;
        if (split) {
          const sp = e?.splitPct || {};
          const others = SPLIT_WAREHOUSES.reduce((s, w) => s + (sp[w] || 0), 0);
          wh[BASE_WAREHOUSE] = (wh[BASE_WAREHOUSE] || 0) + (mt * Math.max(0, 100 - others)) / 100;
          for (const w of SPLIT_WAREHOUSES) wh[w] = (wh[w] || 0) + (mt * (sp[w] || 0)) / 100;
        }
      }
      if (editable) {
        // single month: keep auto + override + baseline + raw split so it stays editable
        const m0 = months[0];
        const e = entryMap.get(`${m0}|${store}|${key}`) || { splitPct: null, totalOverride: null, baseline: null };
        if (e.splitPct) for (const [w, pct] of Object.entries(e.splitPct)) if (pct > 0 && SPLIT_WAREHOUSES.includes(w)) splitWhWithData.add(w);
        return { auto: round(autoVal(m0, store, key)), splitPct: e.splitPct, totalOverride: e.totalOverride, baseline: e.baseline };
      }
      let splitPct: Record<string, number> | null = null;
      if (split && total > 0) {
        splitPct = {};
        for (const w of SPLIT_WAREHOUSES) if (wh[w]) { const p = (wh[w] / total) * 100; splitPct[w] = p; if (p > 0) splitWhWithData.add(w); }
        if (!Object.keys(splitPct).length) splitPct = null;
      }
      return { auto: round(total), splitPct, totalOverride: null, baseline: null };
    }

    const candidateKeys = [...defs.keys()];
    const cellMatrix = new Map<string, Record<string, ReturnType<typeof computeCell>>>();
    for (const s of stores) {
      const rec: Record<string, ReturnType<typeof computeCell>> = {};
      for (const k of candidateKeys) rec[k] = computeCell(s.code, k, defs.get(k)!.split);
      cellMatrix.set(s.code, rec);
    }
    const totalOfKey = (k: string) => stores.reduce((s, st) => s + cellMatrix.get(st.code)![k].auto, 0);
    const shownKeys = candidateKeys.filter((k) => totalOfKey(k) > 0 || keysWithEntry.has(k));
    shownKeys.sort((a, b) => { const ia = orderIndex(a), ib = orderIndex(b); return ia !== ib ? ia - ib : a.localeCompare(b); });
    const categories = shownKeys.map((k) => defs.get(k)!);

    const visibleSplit = SPLIT_WAREHOUSES.filter((w) => splitWhWithData.has(w));
    const warehouses = [BASE_WAREHOUSE, ...visibleSplit];

    const rows = stores.map((s) => {
      const rec = cellMatrix.get(s.code)!;
      const cells: Record<string, ReturnType<typeof computeCell>> = {};
      for (const k of shownKeys) cells[k] = rec[k];
      return { code: s.code, name: s.name, cells };
    });

    res.json({
      status: "success",
      month: editable ? months[0] : `${from} … ${to}`, from, to, editable,
      warehouses, splitWarehouses: visibleSplit,
      allWarehouses: WAREHOUSES, allSplitWarehouses: SPLIT_WAREHOUSES,
      categories, rows,
    });
  } catch (e) {
    res.status(500).json({ status: "error", message: e instanceof Error ? e.message : "Sheets failed" });
  }
});

const entrySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  storeCode: z.string().min(1),
  type: z.string().min(1),
  splitPct: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
  totalOverride: z.number().min(0).nullable().optional(),
});

// POST /sheets/pull-split?month=YYYY-MM
// Pull the DTF/UV warehouse split from DTF Monitor and store it as splitPct.
sheetRouter.post("/pull-split", async (req, res) => {
  try {
    const zone = env.defaultTimezone;
    const month = String(req.query.month || DateTime.now().setZone(zone).toFormat("yyyy-MM"));
    const start = DateTime.fromISO(`${month}-01`, { zone }).startOf("month");
    if (!start.isValid) { res.status(400).json({ status: "error", message: "Invalid month" }); return; }
    const startStr = start.toFormat("yyyy-MM-dd");
    const endStr = start.endOf("month").toFormat("yyyy-MM-dd");

    const split = await fetchWarehouseSplit(startStr, endStr);
    let updated = 0;
    for (const [storeCode, byType] of Object.entries(split)) {
      for (const [type, pct] of Object.entries(byType)) {
        const splitPct = Object.keys(pct).length ? pct : Prisma.DbNull;
        await prisma.sheetEntry.upsert({
          where: { month_storeCode_type: { month, storeCode, type } },
          create: { month, storeCode, type, splitPct },
          update: { splitPct },
        });
        updated++;
      }
    }
    res.json({ status: "success", month, updated });
  } catch (e) {
    res.status(502).json({ status: "error", message: e instanceof Error ? e.message : "Pull failed" });
  }
});

// PUT /sheets/entry — upsert manual warehouse split / total override.
sheetRouter.put("/entry", async (req, res) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ status: "error", message: "Invalid input" }); return; }
  const { month, storeCode, type, splitPct, totalOverride } = parsed.data;
  const data: { splitPct?: Prisma.InputJsonValue | typeof Prisma.DbNull; totalOverride?: number | null } = {};
  if (splitPct !== undefined) data.splitPct = splitPct === null ? Prisma.DbNull : splitPct;
  if (totalOverride !== undefined) data.totalOverride = totalOverride;
  const row = await prisma.sheetEntry.upsert({
    where: { month_storeCode_type: { month, storeCode, type } },
    create: { month, storeCode, type, ...data },
    update: data,
  });
  res.json({ status: "success", entry: row });
});
