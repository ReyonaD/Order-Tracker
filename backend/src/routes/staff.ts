import { Router } from "express";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { requireAuth, requireStaff } from "../middleware/auth";
import { orderMeasures } from "../services/lineItemMeasures";

// Staff productivity report:
//  - Designers: how many order files each designer uploaded (+ their inches/units)
//  - Operators: how many files each machine operator printed (+ their inches/units)
//  - Machines:  same, broken down by the machine a file was printed on
// Grouped over the orderDate range (there is no separate upload/print timestamp,
// so orderDate is the proxy — same basis Reports uses for the operator grouping).
export const staffRouter = Router();
staffRouter.use(requireAuth, requireStaff);

interface Agg { files: number; units: number; inches: number }
function bump(map: Map<string, Agg>, key: string, units: number, inches: number) {
  const e = map.get(key) || { files: 0, units: 0, inches: 0 };
  e.files += 1; e.units += units; e.inches += inches;
  map.set(key, e);
}

// GET /staff/summary?from&to&store=CODE,CODE
staffRouter.get("/summary", async (req, res) => {
  try {
    const zone = env.defaultTimezone;
    const q = req.query as Record<string, string | undefined>;
    const stores = (q.store || "").split(",").map((s) => s.trim()).filter(Boolean);

    const today = DateTime.now().setZone(zone).startOf("day");
    const from = q.from ? DateTime.fromISO(q.from, { zone }).startOf("day") : today.startOf("month");
    const to = q.to ? DateTime.fromISO(q.to, { zone }).startOf("day") : today;
    if (!from.isValid || !to.isValid || to < from) {
      res.status(400).json({ status: "error", message: "Invalid date range" });
      return;
    }

    const where: Prisma.OrderWhereInput = {
      orderDate: { gte: from.toJSDate(), lt: to.plus({ days: 1 }).toJSDate() },
      status: { not: "CANCELLED" },
    };
    if (stores.length === 1) where.storeCode = stores[0];
    else if (stores.length > 1) where.storeCode = { in: stores };

    const orders = await prisma.order.findMany({
      where,
      select: { designerName: true, machinistName: true, machineName: true, lineItems: true },
      take: 100000,
    });

    const designers = new Map<string, Agg>();
    const operators = new Map<string, Agg>();
    const machines = new Map<string, Agg>();
    const dTot: Agg = { files: 0, units: 0, inches: 0 };
    const oTot: Agg = { files: 0, units: 0, inches: 0 };

    for (const o of orders) {
      const m = orderMeasures(o.lineItems);
      const d = (o.designerName || "").trim();
      if (d) { bump(designers, d, m.units, m.inches); dTot.files += 1; dTot.units += m.units; dTot.inches += m.inches; }
      const op = (o.machinistName || "").trim();
      if (op) {
        bump(operators, op, m.units, m.inches);
        oTot.files += 1; oTot.units += m.units; oTot.inches += m.inches;
        bump(machines, (o.machineName || "").trim() || "(unknown)", m.units, m.inches);
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const toArr = (map: Map<string, Agg>) => [...map.entries()]
      .map(([name, v]) => ({ name, files: v.files, units: v.units, inches: round(v.inches) }))
      .sort((a, b) => b.files - a.files);

    res.json({
      status: "success",
      meta: { from: from.toFormat("yyyy-MM-dd"), to: to.toFormat("yyyy-MM-dd"), stores },
      designers: toArr(designers),
      operators: toArr(operators),
      machines: toArr(machines),
      totals: {
        designers: { files: dTot.files, units: dTot.units, inches: round(dTot.inches) },
        operators: { files: oTot.files, units: oTot.units, inches: round(oTot.inches) },
      },
    });
  } catch (e) {
    res.status(500).json({ status: "error", message: e instanceof Error ? e.message : "Staff report failed" });
  }
});
