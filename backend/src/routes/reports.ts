import { Router } from "express";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { requireAuth, requireReports } from "../middleware/auth";
import { orderMeasures } from "../services/lineItemMeasures";

export const reportRouter = Router();
reportRouter.use(requireAuth, requireReports);

type GroupBy = "shipping" | "store" | "day" | "week" | "month" | "item" | "status" | "designer" | "operator" | "machine";
const GROUP_BYS: GroupBy[] = ["shipping", "store", "day", "week", "month", "item", "status", "designer", "operator", "machine"];

// Turn a pickup/shipping order into a single report bucket:
//  - shipping orders -> "Shipping"
//  - pickups -> the named location (Plano/Houston/Mesquite/...) else "Pickup"
// For PROMO, an unlabeled "Pick-up" (legacy CSV imports with no location) is
// folded into "Main Office Pickup" — the main office is PROMO's default pickup.
function shippingBucket(storeCode: string, shippingMethod: string, isPickup: boolean): string {
  if (!isPickup) return "Shipping";
  const l = (shippingMethod || "").toLowerCase();
  if (l.includes("plano")) return "Plano Pickup";
  if (l.includes("houston")) return "Houston Pickup";
  if (l.includes("mesquite")) return "Mesquite Pickup";
  if (l.includes("richardson")) return "Richardson Pickup";
  if (l.includes("main office")) return "Main Office Pickup";
  if (l.includes("portland")) return "Portland Pickup";
  if (l.includes("seattle")) return "Seattle Pickup";
  if (l.includes("san francisco")) return "San Francisco Pickup";
  return storeCode === "PROMO" ? "Main Office Pickup" : "Pickup";
}

interface Row {
  storeCode: string; shippingMethod: string; isPickup: boolean; totalPrice: number | null;
  orderDate: Date; itemTypes: string[]; status: string; lineItems: unknown;
  designerName: string | null; machinistName: string | null; machineName: string | null;
}

interface Cell { count: number; revenue: number; units: number; inches: number }
function addTo(map: Map<string, Cell>, key: string, c: Cell) {
  const e = map.get(key) || { count: 0, revenue: 0, units: 0, inches: 0 };
  e.count += c.count; e.revenue += c.revenue; e.units += c.units; e.inches += c.inches;
  map.set(key, e);
}

// The single non-item bucket key for an order.
function simpleKey(groupBy: GroupBy, o: Row, zone: string): string {
  switch (groupBy) {
    case "shipping": return shippingBucket(o.storeCode, o.shippingMethod, o.isPickup);
    case "store": return o.storeCode;
    case "status": return o.status;
    case "designer": return o.designerName || "(none)";
    case "operator": return o.machinistName || "(none)";
    case "machine": return o.machineName || "(none)";
    case "day": return DateTime.fromJSDate(o.orderDate).setZone(zone).toFormat("yyyy-MM-dd");
    case "week": return DateTime.fromJSDate(o.orderDate).setZone(zone).toFormat("kkkk-'W'WW");
    case "month": return DateTime.fromJSDate(o.orderDate).setZone(zone).toFormat("yyyy-MM");
    default: return "";
  }
}

// One order -> its slice(s) for a dimension: usually one (order totals); the
// "item" dimension yields one slice per item type, each carrying that type's
// own units/inches.
function slicesFor(dim: GroupBy, o: Row, m: { units: number; inches: number; byType: Record<string, { units: number; inches: number }> }, zone: string): Array<{ key: string; units: number; inches: number }> {
  if (dim === "item") {
    const entries = Object.entries(m.byType);
    if (entries.length) return entries.map(([type, tm]) => ({ key: type, units: tm.units, inches: tm.inches }));
    if (o.itemTypes.length) return o.itemTypes.map((t) => ({ key: t, units: 0, inches: 0 }));
    return [{ key: "(none)", units: m.units, inches: m.inches }];
  }
  return [{ key: simpleKey(dim, o, zone), units: m.units, inches: m.inches }];
}

// GET /reports/summary?from&to&store=CODE,CODE&fulfillment=all|pickup|shipping&groupBy=...&groupBy2=...&includeCancelled=0|1
reportRouter.get("/summary", async (req, res) => {
  try {
    const zone = env.defaultTimezone;
    const q = req.query as Record<string, string | undefined>;

    const groupBy: GroupBy = GROUP_BYS.includes(q.groupBy as GroupBy) ? (q.groupBy as GroupBy) : "shipping";
    const gb2 = GROUP_BYS.includes(q.groupBy2 as GroupBy) && q.groupBy2 !== groupBy ? (q.groupBy2 as GroupBy) : null;
    const fulfillment = ["all", "pickup", "shipping"].includes(q.fulfillment || "") ? q.fulfillment : "all";
    const includeCancelled = q.includeCancelled === "1" || q.includeCancelled === "true";
    const stores = (q.store || "").split(",").map((s) => s.trim()).filter(Boolean);

    const today = DateTime.now().setZone(zone).startOf("day");
    const from = q.from ? DateTime.fromISO(q.from, { zone }).startOf("day") : today.minus({ days: 1 });
    const to = q.to ? DateTime.fromISO(q.to, { zone }).startOf("day") : today;
    if (!from.isValid || !to.isValid || to < from) {
      res.status(400).json({ status: "error", message: "Invalid date range" });
      return;
    }

    const where: Prisma.OrderWhereInput = { orderDate: { gte: from.toJSDate(), lt: to.plus({ days: 1 }).toJSDate() } };
    if (stores.length === 1) where.storeCode = stores[0];
    else if (stores.length > 1) where.storeCode = { in: stores };
    if (fulfillment === "pickup") where.isPickup = true;
    if (fulfillment === "shipping") where.isPickup = false;
    if (!includeCancelled) where.status = { not: "CANCELLED" };

    const orders = (await prisma.order.findMany({
      where,
      select: {
        storeCode: true, shippingMethod: true, isPickup: true, totalPrice: true, orderDate: true,
        itemTypes: true, status: true, lineItems: true,
        designerName: true, machinistName: true, machineName: true,
      },
      take: 50000,
    })) as Row[];

    const SEP = String.fromCharCode(1);
    const map = new Map<string, Cell>();
    const totals: Cell = { count: 0, revenue: 0, units: 0, inches: 0 };
    // time series: hourly for a single-day range, else daily
    const singleDay = from.toISODate() === to.toISODate();
    const series = new Map<string, Cell>();

    for (const o of orders) {
      const rev = o.totalPrice ?? 0;
      const m = orderMeasures(o.lineItems);
      totals.count += 1; totals.revenue += rev; totals.units += m.units; totals.inches += m.inches;

      const dt = DateTime.fromJSDate(o.orderDate).setZone(zone);
      addTo(series, singleDay ? dt.toFormat("HH:00") : dt.toFormat("yyyy-MM-dd"), { count: 1, revenue: rev, units: m.units, inches: m.inches });

      const s1 = slicesFor(groupBy, o, m, zone);
      if (!gb2) {
        for (const a of s1) addTo(map, a.key, { count: 1, revenue: rev, units: a.units, inches: a.inches });
      } else {
        const s2 = slicesFor(gb2, o, m, zone);
        for (const a of s1) for (const b of s2) {
          // Whichever axis is "item" governs the per-cell units/inches.
          const units = groupBy === "item" ? a.units : gb2 === "item" ? b.units : m.units;
          const inches = groupBy === "item" ? a.inches : gb2 === "item" ? b.inches : m.inches;
          addTo(map, a.key + SEP + b.key, { count: 1, revenue: rev, units, inches });
        }
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;

    // Setup-month baseline: SheetEntry.baseline holds pre-integration inches/units
    // (e.g. July 1-19). Add it only when the range starts at/before a baseline
    // month's 1st and no fulfillment filter is applied (baseline has no pickup/ship split).
    let baseInches = 0, baseUnits = 0;
    if (fulfillment === "all") {
      const bMonths: string[] = [];
      let d = from.startOf("month");
      while (d <= to) { if (d >= from) bMonths.push(d.toFormat("yyyy-MM")); d = d.plus({ months: 1 }); }
      if (bMonths.length) {
        const bwhere: Prisma.SheetEntryWhereInput = { month: { in: bMonths }, baseline: { not: null } };
        if (stores.length === 1) bwhere.storeCode = stores[0];
        else if (stores.length > 1) bwhere.storeCode = { in: stores };
        const brows = await prisma.sheetEntry.findMany({ where: bwhere, select: { type: true, baseline: true } });
        const INCH = new Set(["DTF", "UV", "Sublimation"]);
        for (const b of brows) if (b.baseline) { if (INCH.has(b.type)) baseInches += b.baseline; else baseUnits += b.baseline; }
      }
    }
    baseInches = round(baseInches);
    const hasBaseline = baseInches > 0 || baseUnits > 0;
    totals.inches += baseInches; totals.units += baseUnits;

    const seriesArr = [...series.entries()]
      .map(([bucket, v]) => ({ bucket, count: v.count, revenue: round(v.revenue), units: v.units, inches: round(v.inches) }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    const baseMeta = { seriesBucket: singleDay ? "hour" : "day", series: seriesArr, hasBaseline, baseline: { inches: baseInches, units: baseUnits } };

    if (!gb2) {
      const groups = [...map.entries()]
        .map(([key, v]) => ({ key, count: v.count, revenue: round(v.revenue), units: v.units, inches: round(v.inches) }))
        .sort((a, b) => b.count - a.count);
      if (hasBaseline) groups.push({ key: "Setup (pre-integration)", count: 0, revenue: 0, units: baseUnits, inches: baseInches });
      res.json({
        status: "success",
        meta: { from: from.toFormat("yyyy-MM-dd"), to: to.toFormat("yyyy-MM-dd"), stores, fulfillment, groupBy, groupBy2: null, includeCancelled, overlaps: groupBy === "item" },
        totals: { count: totals.count, revenue: round(totals.revenue), units: totals.units, inches: round(totals.inches) },
        groups, ...baseMeta,
      });
    } else {
      const cells = [...map.entries()].map(([k, v]) => {
        const [r, c] = k.split(SEP);
        return { r, c, count: v.count, revenue: round(v.revenue), units: v.units, inches: round(v.inches) };
      });
      res.json({
        status: "success",
        meta: { from: from.toFormat("yyyy-MM-dd"), to: to.toFormat("yyyy-MM-dd"), stores, fulfillment, groupBy, groupBy2: gb2, includeCancelled, overlaps: groupBy === "item" || gb2 === "item" },
        totals: { count: totals.count, revenue: round(totals.revenue), units: totals.units, inches: round(totals.inches) },
        cells, ...baseMeta,
      });
    }
  } catch (e) {
    res.status(500).json({ status: "error", message: e instanceof Error ? e.message : "Report failed" });
  }
});
