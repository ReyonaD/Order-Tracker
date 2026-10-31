-- A warehouse may have its own low-stock threshold; NULL = use the product's default.
ALTER TABLE "StockLevel" ADD COLUMN "minStock" DECIMAL(10,2);
