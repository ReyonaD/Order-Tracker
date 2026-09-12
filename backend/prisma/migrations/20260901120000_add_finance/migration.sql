-- Finance tab access flag
ALTER TABLE "User" ADD COLUMN "canViewFinance" BOOLEAN NOT NULL DEFAULT false;

-- Per-store monthly income statement
CREATE TABLE "FinanceStatement" (
    "id" TEXT NOT NULL,
    "storeCode" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinanceStatement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceStatement_storeCode_year_month_key" ON "FinanceStatement"("storeCode", "year", "month");
CREATE INDEX "FinanceStatement_year_idx" ON "FinanceStatement"("year");
