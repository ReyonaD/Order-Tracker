import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { requireAuth, requireFinance } from "../middleware/auth";
import { defForKey, WAREHOUSES, BASE_WAREHOUSE, SPLIT_WAREHOUSES } from "../services/sheetCategories";
import { fetchWarehouseSplit } from "../services/dtfMonitor";

// finance COGS key -> Sheets category key (the measure that drives its cost)
const COGS_MAP: Record<string, string> = {
  uv: "UV", dtf: "DTF", tshirt: "Custom Shirt", sweatshirt: "Sweatshirt",
  sublimation: "Sublimation", film: "DTF Film", powder: "Powder",
  ink: "DTF Ink", heatTape: "Heat Tape", teflon: "Teflon",
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Per-store monthly income statements. The finance employee enters the line
// items by hand; totals are computed in the UI. `data` = { values, notes, custom }.
export const financeRouter = Router();
financeRouter.use(requireAuth, requireFinance);

// Partner profit-split percentages per store (editable). Stored in AppConfig.
// Shape: { "__default__": [{name, pct}], "PICASSO": [...], ... }
financeRouter.get("/splits", async (_req, res) => {
  const row = await prisma.appConfig.findUnique({ where: { key: "financeSplits" } });
  res.json({ status: "success", splits: row?.value ?? {} });
});

financeRouter.put("/splits", async (req, res) => {
  const splits = (req.body?.splits ?? {}) as Prisma.InputJsonValue;
  await prisma.appConfig.upsert({
    where: { key: "financeSplits" },
    create: { key: "financeSplits", value: splits },
    update: { value: splits },
  });
  res.json({ status: "success", splits });
});

// Per-store COGS calculation config (warehouse selection + unit prices). AppConfig.
// Shape: { "CHEETAH": { uv:{warehouses:[],price}, dtf:{warehouses:[],price}, prices:{tshirt,...} }, ... }
financeRouter.get("/cogs-config", async (_req, res) => {
  const row = await prisma.appConfig.findUnique({ where: { key: "financeCogsConfig" } });
  res.json({ status: "success", config: row?.value ?? {}, warehouses: WAREHOUSES });
});

financeRouter.put("/cogs-config", async (req, res) => {
  const config = (req.body?.config ?? {}) as Prisma.InputJsonValue;
  await prisma.appConfig.upsert({
    where: { key: "financeCogsConfig" },
    create: { key: "financeCogsConfig", value: config },
    update: { value: config },
  });
  res.json({ status: "success", config });
});

// COGS measures for one store+month: total per category, and per-warehouse inches
// for the split categories (UV, DTF). Mirrors the Sheets summary's warehouse split.
financeRouter.get("/cogs-measures", async (req, res) => {
  const store = String(req.query.store || "");
  const year = parseInt(String(req.query.year || ""), 10);
  const month = parseInt(String(req.query.month || ""), 10);
  if (!store || !year || !month || month < 1 || month > 12) {
    res.status(400).json({ status: "error", message: "store, year, month required" });
    return;
  }
  const zone = env.defaultTimezone;
  const from = DateTime.fromObject({ year, month, day: 1 }, { zone }).startOf("month");
  const to = from.plus({ months: 1 });
  const monthStr = from.toFormat("yyyy-MM");

  const orders = await prisma.order.findMany({
    where: { storeCode: store, status: { not: "CANCELLED" }, orderDate: { gte: from.toJSDate(), lt: to.toJSDate() } },
    select: { categoryMeasures: true },
  });
  const auto: Record<string, number> = {};
  for (const o of orders) {
    const cm = (o.categoryMeasures as Record<string, number> | null) || {};
    for (const [k, v] of Object.entries(cm)) auto[k] = (auto[k] || 0) + (Number(v) || 0);
  }
  const entries = await prisma.sheetEntry.findMany({ where: { month: monthStr, storeCode: store } });
  const entryMap = new Map<string, { splitPct: Record<string, number> | null; totalOverride: number | null; baseline: number | null }>();
  for (const e of entries) entryMap.set(e.type, { splitPct: (e.splitPct as Record<string, number> | null) ?? null, totalOverride: e.totalOverride, baseline: e.baseline });

  // Dynamic category list: everything with a measure this month (+ any with a
  // Sheets entry), always including UV/DTF. Known categories carry a finKey that
  // maps to a fixed COGS row; the rest land in auto-created custom rows.
  const REVERSE: Record<string, string> = Object.fromEntries(Object.entries(COGS_MAP).map(([f, s]) => [s, f]));
  const keys = new Set<string>([...Object.keys(auto), ...entryMap.keys(), "UV", "DTF"]);
  const categories: Array<{ key: string; label: string; kind: string; split: boolean; finKey: string | null; total: number; wh?: Record<string, number> }> = [];
  for (const sheetKey of keys) {
    const e = entryMap.get(sheetKey);
    const total = (e?.totalOverride != null ? e.totalOverride : (auto[sheetKey] || 0)) + (e?.baseline ?? 0);
    const isCore = sheetKey === "UV" || sheetKey === "DTF";
    if (total <= 0 && !isCore && !e) continue;
    const def = defForKey(sheetKey);
    let wh: Record<string, number> | undefined;
    if (def.split) {
      const sp = e?.splitPct || {};
      const others = SPLIT_WAREHOUSES.reduce((s, w) => s + (sp[w] || 0), 0);
      wh = { [BASE_WAREHOUSE]: r2(total * Math.max(0, 100 - others) / 100) };
      for (const w of SPLIT_WAREHOUSES) wh[w] = r2(total * (sp[w] || 0) / 100);
    }
    categories.push({ key: sheetKey, label: def.label, kind: def.kind, split: def.split, finKey: REVERSE[sheetKey] ?? null, total: r2(total), wh });
  }
  categories.sort((a, b) => (a.split === b.split ? b.total - a.total : a.split ? -1 : 1));
  res.json({ status: "success", store, year, month, warehouses: WAREHOUSES, categories });
});

// Pull the freshest DTF/UV warehouse split from DTF Monitor for a month and
// store it (same as the Sheets "pull split" button), so COGS uses current data.
financeRouter.post("/pull-split", async (req, res) => {
  const year = parseInt(String(req.body?.year || ""), 10);
  const month = parseInt(String(req.body?.month || ""), 10);
  if (!year || !month || month < 1 || month > 12) {
    res.status(400).json({ status: "error", message: "year, month required" });
    return;
  }
  const zone = env.defaultTimezone;
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone }).startOf("month");
  const monthStr = start.toFormat("yyyy-MM");
  const today = DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
  const force = !!req.body?.force;

  // Throttle: skip the DTF Monitor pull if this month was already pulled today.
  const logRow = await prisma.appConfig.findUnique({ where: { key: "financePullLog" } });
  const log = ((logRow?.value as Record<string, string>) || {});
  if (!force && log[monthStr] === today) {
    res.json({ status: "success", skipped: true, lastPull: log[monthStr] });
    return;
  }
  try {
    const split = await fetchWarehouseSplit(start.toFormat("yyyy-MM-dd"), start.endOf("month").toFormat("yyyy-MM-dd"));
    let updated = 0;
    for (const [storeCode, byType] of Object.entries(split)) {
      for (const [type, pct] of Object.entries(byType)) {
        const splitPct = Object.keys(pct).length ? pct : Prisma.DbNull;
        await prisma.sheetEntry.upsert({
          where: { month_storeCode_type: { month: monthStr, storeCode, type } },
          create: { month: monthStr, storeCode, type, splitPct },
          update: { splitPct },
        });
        updated++;
      }
    }
    log[monthStr] = today;
    await prisma.appConfig.upsert({
      where: { key: "financePullLog" },
      create: { key: "financePullLog", value: log as Prisma.InputJsonValue },
      update: { value: log as Prisma.InputJsonValue },
    });
    res.json({ status: "success", updated, pulled: true });
  } catch (e) {
    res.status(502).json({ status: "error", message: e instanceof Error ? e.message : "pull failed" });
  }
});

// GET /finance?year=2026  → every store's statements for that year.
financeRouter.get("/", async (req, res) => {
  const year = parseInt(String(req.query.year || ""), 10);
  if (!year || year < 2000 || year > 3000) {
    res.status(400).json({ status: "error", message: "Invalid year" });
    return;
  }
  const rows = await prisma.financeStatement.findMany({
    where: { year },
    select: { storeCode: true, year: true, month: true, data: true, updatedBy: true, updatedAt: true },
  });
  res.json({ status: "success", year, statements: rows });
});

const putSchema = z.object({
  storeCode: z.string().min(1),
  year: z.number().int().min(2000).max(3000),
  month: z.number().int().min(1).max(12),
  data: z.object({
    values: z.record(z.number()).optional(),
    notes: z.record(z.string()).optional(),
    custom: z.array(z.object({ id: z.string(), section: z.string(), label: z.string() })).optional(),
  }).passthrough(),
});

// PUT /finance  → upsert one store/month statement.
financeRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  const { storeCode, year, month, data } = parsed.data;
  const by = req.user?.email || null;
  const dataJson = data as unknown as Prisma.InputJsonValue;
  const row = await prisma.financeStatement.upsert({
    where: { storeCode_year_month: { storeCode, year, month } },
    create: { storeCode, year, month, data: dataJson, updatedBy: by },
    update: { data: dataJson, updatedBy: by },
    select: { storeCode: true, year: true, month: true, data: true, updatedBy: true, updatedAt: true },
  });
  res.json({ status: "success", statement: row });
});

export default financeRouter;
