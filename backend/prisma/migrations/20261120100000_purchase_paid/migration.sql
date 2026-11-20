-- Finance ticks invoices as paid
ALTER TABLE "PurchaseInvoice" ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "paidAt" TIMESTAMP(3), ADD COLUMN "paidBy" TEXT;
