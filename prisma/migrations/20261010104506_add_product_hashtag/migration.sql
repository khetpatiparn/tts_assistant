-- CreateTable
CREATE TABLE "ProductHashtag" (
    "sourceProductId" TEXT NOT NULL PRIMARY KEY,
    "hashtags" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
