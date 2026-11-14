CREATE TABLE "EmbOrder" (
    "id" TEXT NOT NULL,
    "ssOrderId" INTEGER NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "storeId" INTEGER,
    "shopName" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "shipByDate" TIMESTAMP(3),
    "ssStatus" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "customerName" TEXT,
    "products" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "ssModifiedAt" TIMESTAMP(3),
    "customerService" TEXT,
    "orderStatus" TEXT,
    "designStatus" TEXT,
    "logoOrText" TEXT,
    "preparedBy" TEXT,
    "note" TEXT,
    "printStatus" TEXT,
    "printedAt" TIMESTAMP(3),
    "printedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmbOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmbOrder_ssOrderId_key" ON "EmbOrder"("ssOrderId");
CREATE INDEX "EmbOrder_orderNumber_idx" ON "EmbOrder"("orderNumber");
CREATE INDEX "EmbOrder_orderDate_idx" ON "EmbOrder"("orderDate");

CREATE TABLE "EmbDesignFile" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "pathDisplay" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderNumber" TEXT,
    "size" INTEGER,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbDesignFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmbDesignFile_path_key" ON "EmbDesignFile"("path");
CREATE INDEX "EmbDesignFile_orderNumber_idx" ON "EmbDesignFile"("orderNumber");

CREATE TABLE "EmbOption" (
    "id" TEXT NOT NULL,
    "column" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#e5e7eb',
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EmbOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmbOption_column_value_key" ON "EmbOption"("column", "value");

CREATE TABLE "EmbSyncState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmbSyncState_pkey" PRIMARY KEY ("key")
);

-- the sheet's current choices; more can be added from the Embroidery page
INSERT INTO "EmbOption" ("id","column","value","color","position") VALUES
 ('embopt_cs_adan','customerService','ADAN','#fde68a',0),
 ('embopt_os_mock','orderStatus','NEED MOCK','#fca5a5',0),
 ('embopt_pb_bilge','preparedBy','BILGE','#92400e',0),
 ('embopt_lt_logo','logoOrText','LOGO','#bfdbfe',0),
 ('embopt_lt_text','logoOrText','TEXT','#ddd6fe',1),
 ('embopt_ps_printed','printStatus','PRINTED','#15803d',0),
 ('embopt_ps_cancel','printStatus','CANCELED','#dc2626',1);
