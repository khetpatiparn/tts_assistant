-- CreateTable
CREATE TABLE "PromptEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productName" TEXT NOT NULL,
    "productInfo" TEXT NOT NULL,
    "riskModule" TEXT NOT NULL,
    "extraNotes" TEXT NOT NULL,
    "images" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
