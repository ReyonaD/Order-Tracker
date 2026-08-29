// Backfill Order.categoryMeasures for existing rows using the exact same
// classification the app uses at write time (orderSheetValues).
// Usage: DATABASE_URL=<public> npx ts-node scripts/backfill_category_measures.ts
import { PrismaClient } from "@prisma/client";
import { orderSheetValues } from "../src/services/sheetCategories";

const prisma = new PrismaClient();
const BATCH = 1000;

async function main() {
  const total = await prisma.order.count();
  console.log(`Backfilling categoryMeasures for ${total} order(s)...`);

  let done = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.order.findMany({
      select: { id: true, lineItems: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    await prisma.$transaction(
      rows.map((o) =>
        prisma.order.update({
          where: { id: o.id },
          data: { categoryMeasures: orderSheetValues(o.lineItems) },
        })
      )
    );
    done += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`  ${done}/${total}`);
    if (rows.length < BATCH) break;
  }
  console.log("Done.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
