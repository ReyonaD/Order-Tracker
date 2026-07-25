// One-off: recompute Order.itemTypes with the new labels (Gang Sheet -> DTF,
// add Sublimation, garment brands -> T-shirt). Orders with line items are
// reclassified from the line item names; CSV-imported orders (no line items)
// just get "Gang Sheet" relabeled to "DTF".
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GARMENT = /t-?shirt|\btee\b|sweat\s?shirt|hoodie|hooded|bella|canvas|gildan|comfort colors|apparel/;
function classifyOne(text) {
  const n = (text || "").toLowerCase();
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
function typesFromLineItems(arr) {
  const t = [];
  for (const it of arr) {
    const x = classifyOne(`${it.name || ""} ${it.title || ""} ${it.description || ""}`);
    if (x && !t.includes(x)) t.push(x);
  }
  return t;
}

const orders = await prisma.order.findMany({
  select: { id: true, lineItems: true, itemTypes: true },
});
let changed = 0;
for (const o of orders) {
  const arr = Array.isArray(o.lineItems) ? o.lineItems : null;
  let next;
  if (arr && arr.length) {
    next = typesFromLineItems(arr);
  } else {
    next = (o.itemTypes || []).map((t) => (t === "Gang Sheet" ? "DTF" : t));
  }
  next = [...new Set(next)];
  const cur = o.itemTypes || [];
  if (JSON.stringify(cur) !== JSON.stringify(next)) {
    await prisma.order.update({ where: { id: o.id }, data: { itemTypes: next } });
    changed++;
  }
}
console.log(`itemTypes backfill: ${changed} of ${orders.length} orders updated`);
await prisma.$disconnect();
