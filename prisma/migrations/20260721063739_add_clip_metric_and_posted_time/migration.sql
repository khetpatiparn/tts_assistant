-- AlterTable
ALTER TABLE "PromptEntry" ADD COLUMN "postedTimeOfDay" TEXT;

-- CreateTable
CREATE TABLE "ClipMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "matchedEntryId" TEXT,
    "title" TEXT NOT NULL,
    "postedDate" TEXT NOT NULL,
    "views" INTEGER NOT NULL,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "shares" INTEGER NOT NULL,
    "capturedOn" DATETIME NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClipMetric_matchedEntryId_fkey" FOREIGN KEY ("matchedEntryId") REFERENCES "PromptEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ClipMetric_matchedEntryId_idx" ON "ClipMetric"("matchedEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipMetric_videoId_capturedOn_key" ON "ClipMetric"("videoId", "capturedOn");
