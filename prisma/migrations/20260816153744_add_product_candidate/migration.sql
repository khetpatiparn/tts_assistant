-- CreateTable
CREATE TABLE "ProductCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "commission" REAL NOT NULL,
    "weeklySales" INTEGER,
    "categoryLabel" TEXT NOT NULL,
    "capturedOn" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "note" TEXT NOT NULL DEFAULT '',
    "linkedEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCandidate_nameKey_key" ON "ProductCandidate"("nameKey");

-- CreateIndex
CREATE INDEX "ProductCandidate_status_idx" ON "ProductCandidate"("status");

-- CreateIndex
CREATE INDEX "ProductCandidate_categoryLabel_idx" ON "ProductCandidate"("categoryLabel");
