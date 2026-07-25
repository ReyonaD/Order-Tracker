import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export const dropdownRouter = Router();

dropdownRouter.use(requireAuth);

const CATEGORIES = ["designer", "machinist", "machine", "uploadStatus", "printStatus"] as const;

// List active options grouped by category — used to populate the UI dropdowns.
dropdownRouter.get("/", async (_req, res) => {
  const options = await prisma.dropdownOption.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { sort: "asc" }, { value: "asc" }],
  });
  const grouped: Record<string, string[]> = {};
  for (const c of CATEGORIES) grouped[c] = [];
  for (const o of options) {
    (grouped[o.category] ||= []).push(o.value);
  }
  res.json({ status: "success", options: grouped });
});

// Admin: full list including inactive (for management UI).
dropdownRouter.get("/all", requireRole("ADMIN"), async (_req, res) => {
  const options = await prisma.dropdownOption.findMany({
    orderBy: [{ category: "asc" }, { sort: "asc" }],
  });
  res.json({ status: "success", options });
});

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  value: z.string().min(1),
  sort: z.number().int().default(0),
});

dropdownRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  try {
    const option = await prisma.dropdownOption.create({ data: parsed.data });
    res.status(201).json({ status: "success", option });
  } catch {
    res.status(409).json({ status: "error", message: "Option already exists" });
  }
});

const updateSchema = z.object({
  value: z.string().min(1).optional(),
  sort: z.number().int().optional(),
  active: z.boolean().optional(),
});

dropdownRouter.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  try {
    const option = await prisma.dropdownOption.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ status: "success", option });
  } catch {
    res.status(404).json({ status: "error", message: "Option not found" });
  }
});

dropdownRouter.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  try {
    await prisma.dropdownOption.delete({ where: { id: req.params.id } });
    res.json({ status: "success" });
  } catch {
    res.status(404).json({ status: "error", message: "Option not found" });
  }
});
