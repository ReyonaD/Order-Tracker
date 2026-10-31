-- Stock Inventory: consumables per warehouse (warehouses mirrored from DTF Monitor).
ALTER TABLE "User" ADD COLUMN "canManageStock" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "StockWarehouse" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "machines" JSONB,
    "syncedAt" TIMESTAMP(3),
    CONSTRAINT "StockWarehouse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockWarehouse_name_key" ON "StockWarehouse"("name");

CREATE TABLE "StockProduct" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "minStock" DECIMAL(10,2) NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "StockProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockLevel" (
    "warehouseId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("warehouseId","productId"),
    CONSTRAINT "StockLevel_quantity_check" CHECK ("quantity" >= 0)
);

CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'stock',
    "quantity" DECIMAL(10,2) NOT NULL,
    "before" DECIMAL(10,2) NOT NULL,
    "after" DECIMAL(10,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actor" TEXT NOT NULL DEFAULT '',
    "machine" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'web',
    "batchKey" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockMovement_warehouseId_createdAt_idx" ON "StockMovement"("warehouseId", "createdAt");
CREATE INDEX "StockMovement_kind_createdAt_idx" ON "StockMovement"("kind", "createdAt");
CREATE INDEX "StockMovement_batchKey_idx" ON "StockMovement"("batchKey");

CREATE TABLE "StockBatch" (
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("requestKey")
);

CREATE TABLE "StockNotification" (
    "id" SERIAL NOT NULL,
    "eventKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "StockNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockNotification_eventKey_key" ON "StockNotification"("eventKey");
CREATE INDEX "StockNotification_status_id_idx" ON "StockNotification"("status", "id");

CREATE TABLE "StockAudit" (
    "id" SERIAL NOT NULL,
    "actor" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockAudit_createdAt_idx" ON "StockAudit"("createdAt");

ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "StockWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StockProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "StockWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StockProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The product list of the old stock app (quantities start at zero).
INSERT INTO "StockProduct" ("name", "category", "unit", "minStock") VALUES
  ('DTF Film', 'DTF', 'roll', 3), ('DTF Cyan Ink', 'DTF', 'bottle', 3), ('DTF Magenta Ink', 'DTF', 'bottle', 3),
  ('DTF Yellow Ink', 'DTF', 'bottle', 3), ('DTF Black Ink', 'DTF', 'bottle', 20), ('DTF White Ink', 'DTF', 'bottle', 3),
  ('DTF Powder', 'DTF', 'pcs', 50), ('UV Ink (Cyan)', 'UV', 'bottle', 3), ('UV Ink (Magenta)', 'UV', 'bottle', 3),
  ('UV Ink (Yellow)', 'UV', 'bottle', 3), ('UV Ink (Black)', 'UV', 'bottle', 3), ('UV Film (A)', 'UV', 'roll', 3),
  ('UV Film (B)', 'UV', 'roll', 10), ('UV Varnish', 'UV', 'bottle', 3), ('UV Cleaning Solution', 'UV', 'bottle', 3);
