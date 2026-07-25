// Classify a Shopify line item into an item type, and pull its length (inches).
// Length comes from the size in the name/variant ("N x M" -> M), NOT the SKU
// (SKU is missing on some items and wrong on others).

export interface LineItem {
  name?: string;
  title?: string;
  variant_title?: string;
  sku?: string;
  quantity?: number;
  price?: string;
}

export interface TypeSummary {
  type: string;
  inches: number; // total length = sum(M * quantity) for this type
  qty: number; // total quantity for this type
}

// text color per type (mirrors the backend itemTypes colors)
export const TYPE_COLOR: Record<string, string> = {
  DTF: "#0000FF",
  UV: "#009999",
  Sublimation: "#8250df",
  "T-shirt": "#FF9900",
  Sample: "#996633",
  "Color Chart": "#556B2F",
};

// short label shown in the narrow Item cell (internal type name is unchanged)
const SHORT_LABEL: Record<string, string> = { Sublimation: "Sub" };
export function typeLabel(type: string): string {
  return SHORT_LABEL[type] || type;
}

// preferred left-to-right order in the cell
const TYPE_ORDER = ["DTF", "UV", "Sublimation", "T-shirt", "Sample", "Color Chart"];

// Only these are measured by length (inches). Everything else (garments,
// samples, color charts) is counted by quantity instead.
const LENGTH_TYPES = new Set(["DTF", "UV", "Sublimation"]);

const GARMENT = /t-?shirt|\btee\b|sweat\s?shirt|hoodie|hooded|bella|canvas|gildan|comfort colors|apparel/;

// Classify one line item by its name. Priority matters: an item that says both
// "UV" and "DTF" is UV; one that says "Sublimation" is Sublimation even if it
// also says DTF; a garment that says "DTF" (e.g. "Custom T-Shirt | Bostonian DTF")
// is a T-shirt.
export function classifyItem(li: LineItem): string | null {
  const n = `${li.name || ""} ${li.title || ""}`.toLowerCase();
  if (!n.trim()) return null;
  if (n.includes("sublimation")) return "Sublimation";
  if (n.includes("ink")) return null; // supplies, not a print
  if (n.includes("uv")) return "UV";
  if (GARMENT.test(n)) return "T-shirt";
  if (n.includes("color chart")) return "Color Chart";
  if (n.includes("sample")) return "Sample";
  if (/transfer|gang sheet|\bdtf\b/.test(n)) return "DTF";
  return null;
}

// Pull the length (M) from a size written as "N x M" in the variant or name.
// Handles 22x70, 22" x 30", 22 in x 144 in (12 ft), 22x180 / Standard DTF, 6" x 4".
export function itemLength(li: LineItem): number {
  for (const src of [li.variant_title, li.name, li.title]) {
    if (!src) continue;
    const m = src.match(/(\d+)\s*(?:in\b|")?\s*[xX]\s*"?\s*(\d+)/);
    if (m) return Number(m[2]);
  }
  return 0;
}

// Group an order's line items by type, summing inches (M * qty) and quantity.
export function summarizeItems(items: LineItem[]): TypeSummary[] {
  const map = new Map<string, TypeSummary>();
  for (const li of items) {
    const type = classifyItem(li);
    if (!type) continue;
    const qty = li.quantity ?? 1;
    const inches = LENGTH_TYPES.has(type) ? itemLength(li) * qty : 0;
    const e = map.get(type) || { type, inches: 0, qty: 0 };
    e.inches += inches;
    e.qty += qty;
    map.set(type, e);
  }
  return [...map.values()].sort(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
  );
}

// Old stored itemTypes used "Gang Sheet"; show it as "DTF".
export function relabelType(t: string): string {
  return t === "Gang Sheet" ? "DTF" : t;
}

// Whether a type is measured in inches (vs counted by quantity).
export function hasLength(type: string | null): boolean {
  return !!type && LENGTH_TYPES.has(type);
}
