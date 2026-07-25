-- CreateTable
CREATE TABLE "SheetEntry" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "storeCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cheetahPct" DOUBLE PRECISION,
    "totalOverride" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SheetEntry_month_storeCode_type_key" ON "SheetEntry"("month", "storeCode", "type");
