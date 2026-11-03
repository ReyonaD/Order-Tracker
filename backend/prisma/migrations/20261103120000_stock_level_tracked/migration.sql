-- false = this warehouse does not keep the product (e.g. sublimation supplies in one office only).
ALTER TABLE "StockLevel" ADD COLUMN "tracked" BOOLEAN NOT NULL DEFAULT true;
