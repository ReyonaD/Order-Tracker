// Product categories tracked on the monthly Sheets. Each Shopify line item is
// classified into a category. Known products use curated rules (keywords, order
// matters). Anything that matches no rule becomes a dynamic category named after
// the product itself, so newly-sold products show up automatically.
import { itemLength } from "./lineItemMeasures";

export interface SheetCategory { key: string; label: string; kind: "inches" | "count"; split: boolean }

interface Rule extends SheetCategory { test: RegExp }

// Warehouses that production can happen at. Promo is the base (remainder);
// splitPct stores the share for the others. (Later: sourced from DTF Monitor.)
export const WAREHOUSES = ["Promo", "Cheetah", "Houston", "Mesquite"];
export const BASE_WAREHOUSE = "Promo";
export const SPLIT_WAREHOUSES = WAREHOUSES.filter((w) => w !== BASE_WAREHOUSE);

// Priority order. Supplies/parts are checked before UV/DTF so "DTF Ink",
// "UV DTF AB Film", "UV Cleaning Solution" land in the supply category.
const RULES: Rule[] = [
  { key: "Sublimation", label: "Sublimation", kind: "inches", split: false, test: /sublima/ },
  { key: "Cleaning Solution", label: "Cleaning Solution", kind: "count", split: false, test: /cleaning/ },
  { key: "Vinyl Remover", label: "Vinyl Remover", kind: "count", split: false, test: /vinyl/ },
  { key: "Heat Tape", label: "Heat Tape", kind: "count", split: false, test: /heat\s*tape/ },
  { key: "Teflon", label: "Teflon", kind: "count", split: false, test: /teflon/ },
  { key: "DTF Ink", label: "DTF Ink", kind: "count", split: false, test: /\bink\b/ },
  { key: "Powder", label: "Powder", kind: "count", split: false, test: /powder/ },
  { key: "DTF Film", label: "DTF Film", kind: "count", split: false, test: /\bfilm\b/ },
  { key: "Damper", label: "Damper", kind: "count", split: false, test: /damper/ },
  { key: "Data Cable", label: "Data Cable", kind: "count", split: false, test: /data\s*cable/ },
  { key: "Capping Station", label: "Capping Station", kind: "count", split: false, test: /capping/ },
  { key: "Encoder Strip", label: "Encoder Strip", kind: "count", split: false, test: /encoder/ },
  { key: "Origin Sensor", label: "Origin Sensor", kind: "count", split: false, test: /origin\s*sensor/ },
  { key: "Leather Journal", label: "Leather Journal", kind: "count", split: false, test: /leather\s*journal|journal/ },
  { key: "UV", label: "UV", kind: "inches", split: true, test: /\buv\b/ },
  { key: "Sweatshirt", label: "Sweatshirt", kind: "count", split: false, test: /sweat\s*shirt|hoodie|hooded|crew\s*neck/ },
  { key: "Custom Shirt", label: "Custom Shirt", kind: "count", split: false, test: /t-?shirt|\btee\b|tshirt|custom shirt|bella|canvas|gildan|comfort colors|apparel/ },
  { key: "DTF", label: "DTF", kind: "inches", split: true, test: /transfer|gang sheet|\bdtf\b/ },
];

// Curated display order (shown first, then dynamic categories alphabetically).
export const CURATED_ORDER = [
  "DTF", "UV", "Sublimation", "Custom Shirt", "Sweatshirt",
  "DTF Ink", "Powder", "DTF Film", "Heat Tape", "Teflon",
  "Vinyl Remover", "Cleaning Solution",
  "Damper", "Data Cable", "Capping Station", "Encoder Strip", "Origin Sensor", "Leather Journal",
];
export const CURATED: Record<string, SheetCategory> = Object.fromEntries(
  RULES.map((r) => [r.key, { key: r.key, label: r.label, kind: r.kind, split: r.split }])
);

interface LineItem { name?: string; title?: string; variant_title?: string; quantity?: number }

// Non-product line items (checkout add-ons) that should never become a category.
const IGNORE = /\btip\b|gratuity|\bfee\b|rush|expedit|\bpriority\b|handling|processing|\bdeposit\b|donation|discount|insurance/;

// The category (curated or dynamic) an order line belongs to. Unknown products
// fall back to a count category named after the product title.
export function categoryOf(li: LineItem): SheetCategory | null {
  const text = `${li.name || ""} ${li.title || ""}`.toLowerCase();
  if (!text.trim()) return null;
  if (IGNORE.test(text)) return null; // tips, fees, rush charges, etc. are not products
  for (const r of RULES) if (r.test.test(text)) return { key: r.key, label: r.label, kind: r.kind, split: r.split };
  // dynamic: name the category after the product (title without variant if possible)
  let label = (li.title || li.name || "").trim();
  if (!label && li.name) label = li.name.trim();
  if (!label) return null;
  return { key: label, label, kind: "count", split: false };
}

// def for a stored category key (curated if known, else dynamic count)
export function defForKey(key: string): SheetCategory {
  return CURATED[key] || { key, label: key, kind: "count", split: false };
}

// Per-order measures grouped by category key: inches + units, with the def.
export function orderCategoryMeasures(lineItems: unknown): Record<string, { def: SheetCategory; inches: number; units: number }> {
  const arr = Array.isArray(lineItems) ? (lineItems as LineItem[]) : [];
  const out: Record<string, { def: SheetCategory; inches: number; units: number }> = {};
  for (const li of arr) {
    const def = categoryOf(li);
    if (!def) continue;
    const qty = li.quantity ?? 1;
    const e = out[def.key] || { def, inches: 0, units: 0 };
    e.units += qty;
    if (def.kind === "inches") e.inches += itemLength(li) * qty;
    out[def.key] = e;
  }
  return out;
}
