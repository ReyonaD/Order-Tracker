-- Purchases: product grouping for the price history (category > family > variant).
ALTER TABLE "PurchaseItem" ADD COLUMN "category" TEXT;
ALTER TABLE "PurchaseItem" ADD COLUMN "family" TEXT;
ALTER TABLE "PurchaseItem" ADD COLUMN "variant" TEXT;
CREATE INDEX "PurchaseItem_family_idx" ON "PurchaseItem"("family");
