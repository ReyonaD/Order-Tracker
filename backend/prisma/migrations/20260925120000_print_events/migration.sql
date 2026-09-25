-- Reprint tracking: counters on Sheet + a per-print event log.
ALTER TABLE "Sheet" ADD COLUMN "reprints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sheet" ADD COLUMN "lastReprintAt" TIMESTAMP(3);
ALTER TABLE "Sheet" ADD COLUMN "lastReprintMachine" TEXT;
ALTER TABLE "Sheet" ADD COLUMN "lastReprintOperator" TEXT;

CREATE TABLE "PrintEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "machine" TEXT,
    "operator" TEXT,
    "fileName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrintEvent_orderId_idx" ON "PrintEvent"("orderId");
