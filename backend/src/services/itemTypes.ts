// Port of determineItemTypes() from the original Apps Script.
// Maps Shopify line_items to item type labels + colors.

export interface ItemTypeResult {
  types: string[];
  displayText: string;
  color: string; // set only when exactly one type matched (matches old behavior)
}

interface ShopifyLineItem {
  name?: string;
  title?: string;
  description?: string;
}

const COLORS: Record<string, string> = {
  DTF: "#0000FF",
  UV: "#009999",
  Sublimation: "#8250df",
  "T-shirt": "#FF9900",
  Sample: "#996633",
  "Color Chart": "#556B2F",
};

const GARMENT = /t-?shirt|\btee\b|sweat\s?shirt|hoodie|hooded|bella|canvas|gildan|comfort colors|apparel/;

// Classify one line item into a single type. Priority matters:
//  - "Sublimation" wins even if the name also says DTF
//  - "UV DTF Gang Sheet" is UV (UV before DTF)
//  - a garment named "... DTF" (e.g. "Custom T-Shirt | Bostonian DTF") is a T-shirt
//  - Gang sheets / transfers are DTF (renamed from the old "Gang Sheet")
function classifyOne(text: string): string | null {
  const n = text.toLowerCase();
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

// Sample / T-shirt orders are auto-marked "loaded" in the sheet.
const LOADED_DISPLAY_VALUES = new Set([
  "Sample",
  "T-shirt",
  "Sample, T-shirt",
  "T-shirt, Sample",
]);

export function determineItemTypes(lineItems: ShopifyLineItem[] = []): ItemTypeResult {
  const types: string[] = [];

  for (const item of lineItems) {
    const text = `${item.name || ""} ${item.title || ""} ${item.description || ""}`;
    const t = classifyOne(text);
    if (t && !types.includes(t)) types.push(t);
  }

  const displayText = types.join(", ");
  const color = types.length === 1 ? COLORS[types[0]] || "" : "";

  return { types, displayText, color };
}

export function shouldAutoLoad(displayText: string): boolean {
  return LOADED_DISPLAY_VALUES.has(displayText);
}
