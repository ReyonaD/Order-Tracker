// Per-order measures derived from Shopify line items: total units (quantity) and
// total print length in inches. Length is read from the size "N x M" in the item
// name/variant (M = length); SKUs are unreliable. Classification mirrors the
// frontend itemClassify.ts so the numbers match what's shown in the Item cell.

const GARMENT = /t-?shirt|\btee\b|sweat\s?shirt|hoodie|hooded|bella|canvas|gildan|comfort colors|apparel/;
const LENGTH_TYPES = new Set(["DTF", "UV", "Sublimation"]);

export function classifyItem(name: string): string | null {
  const n = (name || "").toLowerCase();
  if (!n.trim()) return null;
  if (n.includes("sublimation")) return "Sublimation";
  if (n.includes("ink")) return null;
  if (n.includes("uv")) return "UV";
  if (GARMENT.test(n)) return "T-shirt";
  if (n.includes("color chart")) return "Color Chart";
  if (n.includes("sample")) return "Sample";
  if (/transfer|gang sheet|\bdtf\b/.test(n)) return "DTF";
  return null;
}

interface LineItem { name?: string; title?: string; variant_title?: string; quantity?: number }

export function itemLength(li: LineItem): number {
  for (const src of [li.variant_title, li.name, li.title]) {
    if (!src) continue;
    const m = src.match(/(\d+)\s*(?:in\b|")?\s*[xX]\s*"?\s*(\d+)/);
    if (m) return Number(m[2]);
  }
  return 0;
}

export interface Measures {
  units: number;
  inches: number;
  byType: Record<string, { units: number; inches: number }>;
}

export function orderMeasures(lineItems: unknown): Measures {
  const arr = Array.isArray(lineItems) ? (lineItems as LineItem[]) : [];
  const out: Measures = { units: 0, inches: 0, byType: {} };
  for (const li of arr) {
    const qty = li.quantity ?? 1;
    const type = classifyItem(`${li.name || ""} ${li.title || ""}`);
    out.units += qty;
    const inches = type && LENGTH_TYPES.has(type) ? itemLength(li) * qty : 0;
    out.inches += inches;
    if (type) {
      const e = out.byType[type] || { units: 0, inches: 0 };
      e.units += qty;
      e.inches += inches;
      out.byType[type] = e;
    }
  }
  return out;
}
