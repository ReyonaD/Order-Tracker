-- Per-sheet print progress reported by DTF Monitor (one row per gang-sheet part).
CREATE TABLE "Sheet" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 1,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "machine" TEXT,
    "operator" TEXT,
    "rippedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "printedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Sheet_orderId_part_key" ON "Sheet"("orderId", "part");

ALTER TABLE "Sheet" ADD CONSTRAINT "Sheet_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
