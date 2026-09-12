import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";

// Machine-to-machine endpoints (no user login). Protected by a shared API key so
// the DTF printer agent server can mark orders printed instead of writing to Sheets.
export const integrationRouter = Router();

function checkKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.get("X-Api-Key") || "";
  if (!env.integrationApiKey || key !== env.integrationApiKey) {
    res.status(401).json({ status: "error", message: "Invalid or missing API key" });
    return;
  }
  next();
}

integrationRouter.get("/ping", checkKey, (_req, res) => {
  res.json({ status: "ok" });
});

// Lookup an order's print status by code — used by the agent to warn about a
// duplicate print ("this file was already printed by Machine/Operator").
integrationRouter.get("/order-status", checkKey, async (req, res) => {
  const raw = String(req.query.code || "").trim();
  if (!raw) { res.status(400).json({ status: "error", message: "code required" }); return; }
  const code = raw.replace(/^#/, "").toUpperCase();
  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { orderName: { equals: `#${code}`, mode: "insensitive" } },
        { orderName: { equals: code, mode: "insensitive" } },
      ],
    },
    select: { id: true, orderName: true, printStatus: true, machineName: true, machinistName: true },
  });
  if (!order) { res.json({ status: "success", found: false, code }); return; }
  const sheets = await prisma.sheet.findMany({
    where: { orderId: order.id }, orderBy: { part: "asc" },
    select: { part: true, total: true, copies: true, status: true, machine: true, operator: true, printedAt: true, rippedAt: true },
  });
  res.json({
    status: "success", found: true, code, orderName: order.orderName,
    printed: (order.printStatus || "").toLowerCase() === "printed",
    printStatus: order.printStatus || "",
    machine: order.machineName || "",
    operator: order.machinistName || "",
    sheets,
  });
});

const printSchema = z.object({
  orderCode: z.string().min(1), // e.g. "IN3300" or "#IN3300"
  machine: z.string().optional(),
  operator: z.string().optional(),
  printStatus: z.string().default("Printed"),
  // Per-sheet mode (DTF Monitor agent queue). When `part` is present, one Sheet row
  // is upserted and the order's print columns are rolled up from its sheets.
  stage: z.enum(["ripped", "printed"]).optional(),
  part: z.coerce.number().int().min(1).optional(),
  total: z.coerce.number().int().min(1).optional(),
  copies: z.coerce.number().int().min(1).optional(),
  printedCount: z.coerce.number().int().min(0).optional(),
  fileName: z.string().optional(),
});

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

// Recompute an order's print columns from its Sheet rows:
//   all parts printed → "Printed"; some → "Printed 2/5"; only RIP'd → "RIP'd 1/5"; none → null.
// "Printed" (exact) stays the only value the Not-Printed view treats as done, so a
// partly printed order keeps showing up as work to do.
async function rollupOrder(orderId: string) {
  const sheets = await prisma.sheet.findMany({ where: { orderId } });
  if (sheets.length === 0) return;
  const total = Math.max(sheets.length, ...sheets.map((s) => s.total));
  const printed = sheets.filter((s) => s.status === "PRINTED");
  const ripped = sheets.filter((s) => s.status === "RIPPED");
  let printStatus: string | null;
  if (printed.length >= total) printStatus = "Printed";
  else if (printed.length > 0) printStatus = `Printed ${printed.length}/${total}`;
  else if (ripped.length > 0) printStatus = total > 1 ? `RIP'd ${ripped.length}/${total}` : "RIP'd";
  else printStatus = null;
  const src = printed.length > 0 ? printed : ripped; // who printed it, else who RIP'd it
  await prisma.order.update({
    where: { id: orderId },
    data: {
      printStatus,
      machineName: uniq(src.map((s) => s.machine)).join(", ") || null,
      machinistName: uniq(src.map((s) => s.operator)).join(", ") || null,
    },
  });
}

// Called by the DTF Monitor server. Order-level (legacy Print/Done): sets printStatus,
// machineName (MAKINA) and machinistName (MAKINACI). Per-sheet (agent queue, `part`
// given): records the sheet's RIP'd/Printed stage and rolls the order up.
integrationRouter.post("/print", checkKey, async (req, res) => {
  const parsed = printSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  const { machine, operator, printStatus, stage, part, total, copies, printedCount, fileName } = parsed.data;
  const code = parsed.data.orderCode.trim().replace(/^#/, "").toUpperCase();

  // Match orders whose name is "#CODE" or "CODE" (case-insensitive), like the sheet did.
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { orderName: { equals: `#${code}`, mode: "insensitive" } },
        { orderName: { equals: code, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });

  if (orders.length === 0) {
    res.status(404).json({ status: "error", message: `Order '${code}' not found` });
    return;
  }

  if (part) {
    const status = stage === "printed" || (!stage && printStatus.toLowerCase() === "printed") ? "PRINTED" : "RIPPED";
    const now = new Date();
    for (const o of orders) {
      await prisma.sheet.upsert({
        where: { orderId_part: { orderId: o.id, part } },
        create: {
          orderId: o.id, part, total: total ?? 1, copies: copies ?? 1, status, fileName, machine, operator,
          rippedAt: status === "RIPPED" ? now : null,
          printedAt: status === "PRINTED" ? now : null,
          printedCount: printedCount ?? (status === "PRINTED" ? (copies ?? 1) : 0),
        },
        update: {
          status, total, copies, fileName, machine, operator,
          ...(status === "RIPPED" ? { rippedAt: now } : { printedAt: now }),
          ...(printedCount !== undefined ? { printedCount } : status === "PRINTED" ? { printedCount: copies ?? 1 } : {}),
        },
      });
      await rollupOrder(o.id);
    }
  } else {
    const data: Record<string, unknown> = { printStatus };
    if (machine) data.machineName = machine;
    if (operator) data.machinistName = operator;
    await prisma.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data });
  }

  // Keep the machine/operator dropdowns in sync so new names show up in the UI.
  if (machine) {
    await prisma.dropdownOption.upsert({
      where: { category_value: { category: "machine", value: machine } },
      create: { category: "machine", value: machine },
      update: {},
    });
  }
  if (operator) {
    await prisma.dropdownOption.upsert({
      where: { category_value: { category: "machinist", value: operator } },
      create: { category: "machinist", value: operator },
      update: {},
    });
  }

  res.json({ status: "success", orderCode: code, updated: orders.length });
});
