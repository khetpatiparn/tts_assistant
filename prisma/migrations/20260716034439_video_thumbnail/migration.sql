-- CreateTable
CREATE TABLE "VideoThumbnail" (
    "contentId" TEXT NOT NULL PRIMARY KEY,
    "thumbnailUrl" TEXT,
    "title" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
