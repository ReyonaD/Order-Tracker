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

const printSchema = z.object({
  orderCode: z.string().min(1), // e.g. "IN3300" or "#IN3300"
  machine: z.string().optional(),
  operator: z.string().optional(),
  printStatus: z.string().default("Printed"),
});

// Called by the printer agent server on Print/Done. Mirrors the old Google Sheets
// update: sets printStatus, machineName (MAKINA) and machinistName (MAKINACI).
integrationRouter.post("/print", checkKey, async (req, res) => {
  const parsed = printSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  const { machine, operator, printStatus } = parsed.data;
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

  const data: Record<string, unknown> = { printStatus };
  if (machine) data.machineName = machine;
  if (operator) data.machinistName = operator;

  await prisma.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data });

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
