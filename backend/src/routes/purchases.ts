// Purchases (under Finance): upload supplier invoices, let Claude read them, check and
// approve the read, then browse purchases and per-product price history.
import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, requireFinance } from "../middleware/auth";
import { PURCHASE_MIME, checkTotals, enqueueRead } from "../services/purchaseReader";
import { PURCHASE_CATEGORIES, groupUngrouped } from "../services/purchaseGrouper";

export const purchaseRouter = Router();
purchaseRouter.use(requireAuth, requireFinance);

const MAX_MB = 20;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 30 },
});

// everything but the file bytes
const LIST_SELECT = {
  id: true, fileName: true, mimeType: true, fileSize: true, status: true, supplier: true, invoiceNumber: true,
  invoiceDate: true, currency: true, subtotal: true, tax: true, shipping: true, discount: true, total: true,
  checkNote: true, aiModel: true, error: true, uploadedBy: true, approvedBy: true, approvedAt: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.PurchaseInvoiceSelect;

const userName = async (id: string) =>
  (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;

purchaseRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const where: Prisma.PurchaseInvoiceWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [
      { supplier: { contains: q, mode: "insensitive" } },
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { fileName: { contains: q, mode: "insensitive" } },
      { items: { some: { description: { contains: q, mode: "insensitive" } } } },
    ] } : {}),
  };
  const invoices = await prisma.purchaseInvoice.findMany({
    where, select: { ...LIST_SELECT, _count: { select: { items: true } } }, orderBy: { createdAt: "desc" }, take: 1000,
  });
  res.json({ status: "success", invoices });
});

purchaseRouter.post(
  "/upload",
  (req, res, next) =>
    upload.array("files", 30)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ status: "error", message: `A file is larger than ${MAX_MB} MB` });
        return;
      }
      if (err) { res.status(400).json({ status: "error", message: err instanceof Error ? err.message : "Upload error" }); return; }
      next();
    }),
  async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) { res.status(400).json({ status: "error", message: "No files" }); return; }
    const who = await userName(req.user!.id);
    const results: { fileName: string; outcome: "added" | "duplicate" | "rejected"; message?: string; id?: string }[] = [];
    for (const f of files) {
      if (!(PURCHASE_MIME as readonly string[]).includes(f.mimetype)) {
        results.push({ fileName: f.originalname, outcome: "rejected", message: "Only PDF, PNG, JPG, GIF or WEBP files can be read" });
        continue;
      }
      const fileHash = crypto.createHash("sha256").update(f.buffer).digest("hex");
      const existing = await prisma.purchaseInvoice.findUnique({ where: { fileHash }, select: { id: true } });
      if (existing) { results.push({ fileName: f.originalname, outcome: "duplicate", id: existing.id, message: "This file was uploaded before" }); continue; }
      try {
        const inv = await prisma.purchaseInvoice.create({
          data: { fileName: f.originalname, mimeType: f.mimetype, fileSize: f.size, fileHash, fileData: f.buffer, uploadedBy: who },
          select: { id: true },
        });
        enqueueRead(inv.id);
        results.push({ fileName: f.originalname, outcome: "added", id: inv.id });
      } catch (e) {
        // two copies of the same file in one upload: the unique hash catches the second
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          results.push({ fileName: f.originalname, outcome: "duplicate", message: "This file was uploaded before" });
        } else throw e;
      }
    }
    res.json({ status: "success", results });
  }
);

// Price history: every item on an approved invoice, newest first. The UI groups by product.
purchaseRouter.get("/products", async (_req, res) => {
  const items = await prisma.purchaseItem.findMany({
    where: { invoice: { status: "approved" } },
    select: {
      id: true, description: true, sku: true, quantity: true, unit: true, unitPrice: true, lineTotal: true,
      category: true, family: true, variant: true,
      invoice: { select: { id: true, supplier: true, invoiceDate: true, invoiceNumber: true, currency: true, createdAt: true } },
    },
    take: 20000,
  });
  const ungrouped = await prisma.purchaseItem.count({ where: { family: null } });
  res.json({ status: "success", items, categories: PURCHASE_CATEGORIES, ungrouped });
});

// Group every line that has no product group yet (lines read before grouping existed,
// or whose grouping failed).
purchaseRouter.post("/group", async (_req, res) => {
  try {
    const grouped = await groupUngrouped();
    res.json({ status: "success", grouped });
  } catch (e) {
    res.status(502).json({ status: "error", message: e instanceof Error ? e.message : "Grouping failed" });
  }
});

// Move a product (every line with that description) or a whole family to another group.
const moveSchema = z.object({
  description: z.string().min(1).optional(),
  fromFamily: z.string().min(1).optional(),
  category: z.enum(PURCHASE_CATEGORIES),
  family: z.string().trim().min(1).max(120),
  variant: z.string().trim().max(60).nullable().optional(),
}).refine((b) => !!b.description !== !!b.fromFamily, { message: "description or fromFamily" });

purchaseRouter.patch("/groups", async (req, res) => {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ status: "error", message: "Invalid group" }); return; }
  const b = parsed.data;
  const where: Prisma.PurchaseItemWhereInput = b.description
    ? { description: { equals: b.description.trim(), mode: "insensitive" } }
    : { family: b.fromFamily };
  const r = await prisma.purchaseItem.updateMany({
    where,
    data: { category: b.category, family: b.family, ...(b.variant !== undefined ? { variant: b.variant || null } : {}) },
  });
  res.json({ status: "success", updated: r.count });
});

purchaseRouter.get("/:id", async (req, res) => {
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: req.params.id },
    select: { ...LIST_SELECT, items: { orderBy: { position: "asc" } } },
  });
  if (!invoice) { res.status(404).json({ status: "error", message: "Invoice not found" }); return; }
  res.json({ status: "success", invoice });
});

// The original file (auth via header or ?token=, so it opens in an <iframe>/<img>).
purchaseRouter.get("/:id/file", async (req, res) => {
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id: req.params.id }, select: { fileName: true, mimeType: true, fileData: true } });
  if (!inv) { res.status(404).json({ status: "error", message: "Invoice not found" }); return; }
  res.setHeader("Content-Type", inv.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(inv.fileName)}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(Buffer.from(inv.fileData));
});

const n = z.number().finite().nullable();
const editSchema = z.object({
  supplier: z.string().max(200).nullable(),
  invoiceNumber: z.string().max(100).nullable(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  currency: z.string().max(10).nullable(),
  subtotal: n, tax: n, shipping: n, discount: n, total: n,
  items: z.array(z.object({
    description: z.string().min(1).max(500),
    sku: z.string().max(100).nullable(),
    quantity: n, unit: z.string().max(30).nullable(), unitPrice: n, lineTotal: n,
  })).max(500),
});

// Save the reviewer's corrections (header + full item list).
purchaseRouter.put("/:id", async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ status: "error", message: "Invalid invoice data" }); return; }
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id: req.params.id }, select: { status: true } });
  if (!inv) { res.status(404).json({ status: "error", message: "Invoice not found" }); return; }
  if (inv.status === "processing") { res.status(409).json({ status: "error", message: "The invoice is still being read" }); return; }
  const d = parsed.data;
  const blank = (s: string | null) => (s && s.trim() ? s.trim() : null);
  // an edited line keeps its product group when its description did not change
  const before = await prisma.purchaseItem.findMany({ where: { invoiceId: req.params.id }, select: { description: true, category: true, family: true, variant: true } });
  const groupOf = new Map(before.filter((b) => b.family).map((b) => [b.description.trim().toLowerCase(), { category: b.category, family: b.family, variant: b.variant }]));
  const checkNote = checkTotals({
    ...d, items: d.items.map((i) => ({ quantity: i.quantity, unit_price: i.unitPrice, line_total: i.lineTotal })),
  });
  await prisma.$transaction([
    prisma.purchaseItem.deleteMany({ where: { invoiceId: req.params.id } }),
    prisma.purchaseInvoice.update({
      where: { id: req.params.id },
      data: {
        supplier: blank(d.supplier), invoiceNumber: blank(d.invoiceNumber), invoiceDate: d.invoiceDate,
        currency: blank(d.currency)?.toUpperCase() ?? null,
        subtotal: d.subtotal, tax: d.tax, shipping: d.shipping, discount: d.discount, total: d.total, checkNote,
        ...(inv.status === "failed" ? { status: "review", error: null } : {}),
        items: { create: d.items.map((i, position) => ({
          ...i, position, description: i.description.trim(), sku: blank(i.sku), unit: blank(i.unit),
          ...(groupOf.get(i.description.trim().toLowerCase()) ?? {}),
        })) },
      },
    }),
  ]);
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id: req.params.id }, select: { ...LIST_SELECT, items: { orderBy: { position: "asc" } } },
  });
  res.json({ status: "success", invoice });
  groupUngrouped(req.params.id).catch((e) => console.error("Purchases grouping:", e instanceof Error ? e.message : e));
});

purchaseRouter.post("/:id/approve", async (req, res) => {
  const who = await userName(req.user!.id);
  const r = await prisma.purchaseInvoice.updateMany({
    where: { id: req.params.id, status: "review" },
    data: { status: "approved", approvedBy: who, approvedAt: new Date() },
  });
  if (!r.count) { res.status(409).json({ status: "error", message: "Only an invoice waiting for review can be approved" }); return; }
  res.json({ status: "success" });
});

// Approved by mistake: back to review (it leaves the price history until approved again).
purchaseRouter.post("/:id/unapprove", async (req, res) => {
  const r = await prisma.purchaseInvoice.updateMany({
    where: { id: req.params.id, status: "approved" },
    data: { status: "review", approvedBy: null, approvedAt: null },
  });
  if (!r.count) { res.status(409).json({ status: "error", message: "The invoice is not approved" }); return; }
  res.json({ status: "success" });
});

// Read the file again from scratch (replaces the current read and any corrections).
purchaseRouter.post("/:id/reread", async (req, res) => {
  const r = await prisma.purchaseInvoice.updateMany({
    where: { id: req.params.id, status: { in: ["review", "failed"] } },
    data: { status: "processing", error: null },
  });
  if (!r.count) { res.status(409).json({ status: "error", message: "Only an unapproved invoice can be read again" }); return; }
  enqueueRead(req.params.id);
  res.json({ status: "success" });
});

purchaseRouter.delete("/:id", async (req, res) => {
  const r = await prisma.purchaseInvoice.deleteMany({ where: { id: req.params.id } });
  if (!r.count) { res.status(404).json({ status: "error", message: "Invoice not found" }); return; }
  res.json({ status: "success" });
});
