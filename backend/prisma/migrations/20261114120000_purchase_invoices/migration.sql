-- Purchases (Finance): uploaded supplier invoices and the line items read from them.
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileData" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "supplier" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TEXT,
    "currency" TEXT,
    "subtotal" DOUBLE PRECISION,
    "tax" DOUBLE PRECISION,
    "shipping" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "checkNote" TEXT,
    "aiModel" TEXT,
    "error" TEXT,
    "uploadedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseInvoice_fileHash_key" ON "PurchaseInvoice"("fileHash");
CREATE INDEX "PurchaseInvoice_status_idx" ON "PurchaseInvoice"("status");
CREATE INDEX "PurchaseInvoice_invoiceDate_idx" ON "PurchaseInvoice"("invoiceDate");
CREATE INDEX "PurchaseInvoice_supplier_idx" ON "PurchaseInvoice"("supplier");

CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "unitPrice" DOUBLE PRECISION,
    "lineTotal" DOUBLE PRECISION,
    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseItem_invoiceId_idx" ON "PurchaseItem"("invoiceId");
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
