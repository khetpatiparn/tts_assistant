-- CreateTable
CREATE TABLE "ChannelMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statsOn" DATETIME NOT NULL,
    "videoViews" INTEGER NOT NULL,
    "profileViews" INTEGER NOT NULL,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "shares" INTEGER NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMetric_statsOn_key" ON "ChannelMetric"("statsOn");
