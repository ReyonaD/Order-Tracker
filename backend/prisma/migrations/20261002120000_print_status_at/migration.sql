-- When the print status last changed, so the table can show the time of the
-- operator's latest action (Downloaded / RIP'd / Printed).
ALTER TABLE "Order" ADD COLUMN "printStatusAt" TIMESTAMP(3);

-- Backfill from what the floor already reported per sheet.
UPDATE "Order" o
SET "printStatusAt" = s.t
FROM (
  SELECT "orderId", MAX(COALESCE("printedAt", "rippedAt", "downloadedAt")) AS t
  FROM "Sheet"
  GROUP BY "orderId"
) s
WHERE o.id = s."orderId" AND o."printStatus" IS NOT NULL AND s.t IS NOT NULL;
