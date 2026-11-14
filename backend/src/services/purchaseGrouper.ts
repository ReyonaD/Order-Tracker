// Sorts purchase line items into category > family > variant with Claude Haiku (text only,
// cheap), so the price history shows "DTF Ink 1L" once with Cyan/Magenta/… under it instead
// of five unrelated rows. Families already in use are passed in, so a new supplier's item
// lands in the existing family instead of starting a new one.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { prisma } from "../db";

export const PURCHASE_CATEGORIES = [
  "DTF Film", "DTF Ink", "DTF Powder", "UV DTF Ink & Varnish", "UV DTF Film",
  "Cleaning & Maintenance", "Spare Parts", "Machines & Equipment", "Heat Press Supplies",
  "Blank Apparel", "Packaging & Shipping", "Food & Catering", "Services", "Other",
] as const;

const Grouping = z.object({
  items: z.array(z.object({
    index: z.number().int(),
    category: z.enum(PURCHASE_CATEGORIES),
    family: z.string(),
    variant: z.string().nullable(),
  })),
});

const SYSTEM = `You sort purchase line items of a DTF / UV DTF printing business for a price history.

For each item give:
- category: one of the allowed categories.
- family: a short, generic English product name shared by items that differ only in color or another minor variant. Keep what changes the price: size, volume, weight, width/length, model (e.g. "DTF Ink 1L", "UV DTF Ink 1kg", "DTF Film 24in Instant Peel 328ft", "Capping Station Epson I3200"). Title case, no SKU, no supplier name.
- variant: what tells this item apart inside its family ("Cyan", "White", "Glitter"), or null when there is nothing.

When an item belongs to one of the existing families listed, use that family name exactly (same spelling). Ignore remarks such as "(FREE GIFT)", "No Label" or "Box" when grouping. Packaging & Shipping is for boxes, mailers and freight bought for the shop's own shipping; a delivery fee on a food or service invoice belongs with that invoice's category.`;

const GROUP_MODEL = "claude-haiku-5-5";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

type In = { description: string; sku: string | null };
type Out = { category: string; family: string; variant: string | null };

async function classify(items: In[], families: { category: string; family: string }[]): Promise<(Out | null)[]> {
  const res = await getClient().beta.messages.parse({
    model: GROUP_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: JSON.stringify({
        allowed_categories: PURCHASE_CATEGORIES,
        existing_families: families,
        items: items.map((it, index) => ({ index, description: it.description, sku: it.sku })),
      }),
    }],
    output_config: { effort: "low", format: betaZodOutputFormat(Grouping) },
  });
  if (!res.parsed_output) throw new Error(`grouping answer could not be read (${res.stop_reason})`);
  const out: (Out | null)[] = items.map(() => null);
  for (const g of res.parsed_output.items) {
    if (g.index >= 0 && g.index < items.length && g.family.trim())
      out[g.index] = { category: g.category, family: g.family.trim(), variant: g.variant?.trim() || null };
  }
  return out;
}

const keyOf = (d: string) => d.trim().replace(/\s+/g, " ").toLowerCase();

/** Group every item that has no family yet (optionally only one invoice's). Items with the
 *  same description as an already grouped item copy that grouping without asking the model.
 *  Returns how many items got a group. */
export async function groupUngrouped(invoiceId?: string): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  const todo = await prisma.purchaseItem.findMany({
    where: { family: null, ...(invoiceId ? { invoiceId } : {}) },
    select: { id: true, description: true, sku: true },
  });
  if (!todo.length) return 0;

  const grouped = await prisma.purchaseItem.findMany({
    where: { family: { not: null } },
    select: { description: true, category: true, family: true, variant: true },
    distinct: ["description"],
  });
  const known = new Map(grouped.map((g) => [keyOf(g.description), g]));
  const families = [...new Map(grouped.map((g) => [`${g.category}|${g.family}`, { category: g.category!, family: g.family! }])).values()];

  let done = 0;
  // one model call per distinct description, at most 80 per request
  const byDesc = new Map<string, typeof todo>();
  for (const it of todo) {
    const k = keyOf(it.description);
    const same = known.get(k);
    if (same) {
      await prisma.purchaseItem.update({ where: { id: it.id }, data: { category: same.category, family: same.family, variant: same.variant } });
      done++;
      continue;
    }
    if (!byDesc.has(k)) byDesc.set(k, []);
    byDesc.get(k)!.push(it);
  }
  const keys = [...byDesc.keys()];
  for (let i = 0; i < keys.length; i += 80) {
    const chunk = keys.slice(i, i + 80);
    const result = await classify(chunk.map((k) => byDesc.get(k)![0]), families);
    for (let j = 0; j < chunk.length; j++) {
      const g = result[j];
      if (!g) continue;
      const ids = byDesc.get(chunk[j])!.map((x) => x.id);
      await prisma.purchaseItem.updateMany({ where: { id: { in: ids } }, data: g });
      done += ids.length;
      if (!families.some((f) => f.family === g.family && f.category === g.category)) families.push({ category: g.category, family: g.family });
    }
  }
  return done;
}
