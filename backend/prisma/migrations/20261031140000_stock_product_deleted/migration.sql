-- A deleted product with history disappears from every list but its movements stay.
ALTER TABLE "StockProduct" ADD COLUMN "deletedAt" TIMESTAMP(3);
