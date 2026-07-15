-- CreateTable
CREATE TABLE "AffiliateOrder" (
    "orderId" TEXT NOT NULL PRIMARY KEY,
    "productName" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "gmv" REAL NOT NULL,
    "itemsSold" INTEGER NOT NULL,
    "itemsRefunded" INTEGER NOT NULL,
    "actualCommission" REAL,
    "finalRevenue" REAL,
    "orderDate" DATETIME NOT NULL,
    "matchedEntryId" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateOrder_matchedEntryId_fkey" FOREIGN KEY ("matchedEntryId") REFERENCES "PromptEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AffiliateOrder_contentId_idx" ON "AffiliateOrder"("contentId");

-- CreateIndex
CREATE INDEX "AffiliateOrder_orderDate_idx" ON "AffiliateOrder"("orderDate");
