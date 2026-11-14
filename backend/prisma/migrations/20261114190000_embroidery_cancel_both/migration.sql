-- CANCELED in order status means CANCELED in print status too (unless it was printed)
UPDATE "EmbOrder" SET "printStatus" = 'CANCELED', "printedAt" = NULL, "printedBy" = NULL
WHERE "orderStatus" = 'CANCELED' AND ("printStatus" IS NULL OR "printStatus" NOT IN ('PRINTED','CANCELED'));
UPDATE "EmbOrder" SET "orderStatus" = 'CANCELED' WHERE "printStatus" = 'CANCELED' AND "orderStatus" IS NULL;
