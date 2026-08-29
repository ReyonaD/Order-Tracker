// Dump the full WebhookEvent history for one order name.
// Usage: DATABASE_URL=<public> node scripts/dump_webhooks.mjs P24878
import { PrismaClient } from "@prisma/client";

const needle = (process.argv[2] || "").trim();
if (!needle) { console.error("Pass an order code, e.g. node dump_webhooks.mjs P24878"); process.exit(1); }

const prisma = new PrismaClient();

const events = await prisma.webhookEvent.findMany({
  where: { orderName: { contains: needle, mode: "insensitive" } },
  orderBy: { receivedAt: "asc" },
});

console.log(`\n=== WebhookEvent history for "${needle}" — ${events.length} event(s) ===\n`);
for (const e of events) {
  const p = e.payload || {};
  const extra = [
    p.financial_status ? `financial=${p.financial_status}` : null,
    p.fulfillment_status ? `fulfillment=${p.fulfillment_status}` : null,
    p.cancelled_at ? `cancelled_at=${p.cancelled_at}` : null,
  ].filter(Boolean).join(" ");
  console.log(`${e.receivedAt.toISOString()}  [${e.storeCode}]  topic=${e.topic || "-"}  kind=${e.kind}  status=${e.status}`);
  console.log(`    order=${e.orderName || "-"}  processedAt=${e.processedAt ? e.processedAt.toISOString() : "-"}`);
  if (extra) console.log(`    payload: ${extra}`);
  if (e.message) console.log(`    message: ${e.message.slice(0, 300)}`);
  console.log("");
}

await prisma.$disconnect();
