// Reads an uploaded supplier invoice (PDF or image) into a header + line items with
// Claude. Claude Haiku reads it first; when the line items don't add up to the
// invoice's own totals, Claude Sonnet reads it once more. The result always waits
// for a Finance user to check and approve it (status "review").
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { prisma } from "../db";
import { groupUngrouped } from "./purchaseGrouper";

export const READ_MODEL = "claude-haiku-5-5";
export const RECHECK_MODEL = "claude-sonnet-5-5";

export const PURCHASE_MIME = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const num = z.number().nullable();
const InvoiceRead = z.object({
  supplier: z.string().nullable(),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable(),
  currency: z.string().nullable(),
  subtotal: num,
  tax: num,
  shipping: num,
  discount: num,
  total: num,
  items: z.array(z.object({
    description: z.string(),
    sku: z.string().nullable(),
    quantity: num,
    unit: z.string().nullable(),
    unit_price: num,
    line_total: num,
  })),
  notes: z.string().nullable(),
});
type InvoiceRead = z.infer<typeof InvoiceRead>;

const SYSTEM = `You read the purchase invoices, receipts and order confirmations of a DTF / UV printing business. Most are supplies (film, ink, powder, blank shirts, machine parts, packaging), but any purchase can appear (food and catering, services, rent, software). Extract what the document says so it can be checked against the original.

- One entry in items per line item, in the printed order, across every page. Keep each description as printed: do not translate, shorten or merge lines.
- Numbers are plain numbers without currency symbols or thousands separators. Leave a value null when the document does not show it.
- A quantity written as a count times a price ("26X13", "26 x $13", "3 @ 4.50") is quantity 26 and unit_price 13. When a line shows quantity and unit price but no line total, line_total is quantity × unit_price. Do not invent any other missing value.
- A figure printed on an item line that is really the invoice total (it equals the total due and the other lines have none) is not that line's total.
- Shipping, freight and handling charges go to shipping; sales tax / VAT goes to tax. Neither is an item. A discount goes to discount as a positive amount.
- invoice_date as YYYY-MM-DD. A date with slashes from a US business is month/day/year (11/9/2026 = 2026-11-09). currency as an ISO 4217 code (USD for "$" from a US supplier).
- supplier is the company that issued the invoice, not the customer it is billed to.
- Put anything unclear (an unreadable line, a total that seems wrong, a credit note) in notes; otherwise notes is null.`;

let client: Anthropic | null = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  return (client ??= new Anthropic());
};

async function readWith(model: string, mimeType: string, data: Buffer): Promise<InvoiceRead> {
  const b64 = data.toString("base64");
  const file: Anthropic.Beta.BetaContentBlockParam = mimeType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mimeType as ImageMime, data: b64 } };
  const res = await getClient().beta.messages.parse({
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: [file, { type: "text", text: "Extract this invoice." }] }],
    output_config: { effort: "medium", format: betaZodOutputFormat(InvoiceRead) },
    // Sonnet: if a safety classifier declines, the API retries on a fallback model itself
    ...(model === RECHECK_MODEL ? { betas: ["server-side-fallback-2026-07-01" as Anthropic.Beta.AnthropicBeta], fallbacks: "default" as const } : {}),
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to read this file");
  if (res.stop_reason === "max_tokens") throw new Error("The invoice is too long to read in one pass");
  if (!res.parsed_output) throw new Error("The model's answer could not be read");
  return res.parsed_output;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Do the line items add up to the invoice's own totals? Returns why not, or null. */
export function checkTotals(r: Pick<InvoiceRead, "subtotal" | "tax" | "shipping" | "discount" | "total"> & {
  items: { quantity: number | null; unit_price: number | null; line_total: number | null }[];
}): string | null {
  if (!r.items.length) return "No line items were found.";
  const line = (i: { quantity: number | null; unit_price: number | null; line_total: number | null }) =>
    i.line_total ?? (i.quantity != null && i.unit_price != null ? i.quantity * i.unit_price : null);
  const lines = r.items.map(line);
  if (lines.some((v) => v == null)) return "Some lines have no amount.";
  const itemsSum = r2(lines.reduce((a: number, v) => a + (v as number), 0));
  const extras = (r.tax ?? 0) + (r.shipping ?? 0) - (r.discount ?? 0);
  const expected = r.subtotal ?? (r.total != null ? r2(r.total - extras) : null);
  if (expected == null) return "The invoice shows no subtotal or total to compare with.";
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.005);
  if (!close(itemsSum, expected)) return `Line items add up to ${itemsSum.toFixed(2)}, the invoice says ${expected.toFixed(2)}.`;
  if (r.subtotal != null && r.total != null && !close(r2(r.subtotal + extras), r.total))
    return `Subtotal + tax + shipping − discount = ${r2(r.subtotal + extras).toFixed(2)}, the invoice total is ${r.total.toFixed(2)}.`;
  return null;
}

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};
const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null);

async function readInvoice(id: string): Promise<void> {
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, select: { mimeType: true, fileData: true } });
  if (!inv) return;
  const data = Buffer.from(inv.fileData);
  let read: InvoiceRead;
  let model = READ_MODEL;
  let problem: string | null;
  try {
    read = await readWith(READ_MODEL, inv.mimeType, data);
    problem = checkTotals(read);
    if (problem) {
      // the stronger model's read is kept even if it doesn't add up either: the reviewer sees why
      read = await readWith(RECHECK_MODEL, inv.mimeType, data);
      model = RECHECK_MODEL;
      problem = checkTotals(read);
    }
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e);
    console.error(`Purchase invoice ${id}: read failed: ${msg}`);
    await prisma.purchaseInvoice.update({ where: { id }, data: { status: "failed", error: msg.slice(0, 500) } });
    return;
  }
  const checkNote = [problem, clean(read.notes)].filter(Boolean).join(" ") || null;
  await prisma.$transaction([
    prisma.purchaseItem.deleteMany({ where: { invoiceId: id } }),
    prisma.purchaseInvoice.update({
      where: { id },
      data: {
        status: "review", error: null, aiModel: model, checkNote,
        supplier: clean(read.supplier), invoiceNumber: clean(read.invoice_number), invoiceDate: isoDate(read.invoice_date),
        currency: clean(read.currency)?.toUpperCase() ?? null,
        subtotal: read.subtotal, tax: read.tax, shipping: read.shipping, discount: read.discount, total: read.total,
        items: {
          create: read.items.map((it, i) => ({
            position: i, description: it.description.trim() || "(no description)", sku: clean(it.sku),
            quantity: it.quantity, unit: clean(it.unit), unitPrice: it.unit_price,
            lineTotal: it.line_total ?? (it.quantity != null && it.unit_price != null ? r2(it.quantity * it.unit_price) : null),
          })),
        },
      },
    }),
  ]);
  // sort the new lines into product groups; a failure here only leaves them ungrouped
  await groupUngrouped(id).catch((e) => console.error(`Purchase invoice ${id}: grouping failed:`, e instanceof Error ? e.message : e));
}

// Small in-process queue: a batch upload of 30 invoices reads two at a time.
const queue: string[] = [];
let running = 0;
const CONCURRENCY = 2;

export function enqueueRead(id: string) {
  if (!queue.includes(id)) queue.push(id);
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    running++;
    readInvoice(id)
      .catch((e) => console.error(`Purchase invoice ${id}:`, e))
      .finally(() => { running--; pump(); });
  }
}

/** On startup: invoices left "processing" by a restart are read again. */
export async function resumePendingReads() {
  const rows = await prisma.purchaseInvoice.findMany({ where: { status: "processing" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  rows.forEach((r) => enqueueRead(r.id));
  if (rows.length) console.log(`Purchases: re-reading ${rows.length} invoice(s) left processing`);
}
