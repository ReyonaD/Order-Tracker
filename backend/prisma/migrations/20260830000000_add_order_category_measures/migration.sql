-- Precomputed per-category sheet values so Sheets can sum stored numbers.
ALTER TABLE "Order" ADD COLUMN "categoryMeasures" JSONB;
