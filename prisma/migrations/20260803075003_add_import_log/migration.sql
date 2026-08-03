-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "summary" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "ImportLog_kind_uploadedAt_idx" ON "ImportLog"("kind", "uploadedAt");

-- CreateIndex
CREATE INDEX "ImportLog_fileHash_idx" ON "ImportLog"("fileHash");
