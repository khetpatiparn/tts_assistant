-- AlterTable
ALTER TABLE "ProductCandidate" ADD COLUMN "sourceProductId" TEXT;

-- CreateTable
CREATE TABLE "CandidateImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateImage_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ProductCandidate" ("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE INDEX "CandidateImage_candidateId_idx" ON "CandidateImage"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCandidate_batchId_sourceProductId_key" ON "ProductCandidate"("batchId", "sourceProductId");
