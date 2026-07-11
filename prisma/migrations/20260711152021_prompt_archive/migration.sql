-- CreateTable
CREATE TABLE "CorePrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PromptEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productName" TEXT NOT NULL,
    "productInfo" TEXT NOT NULL,
    "riskModule" TEXT NOT NULL,
    "extraNotes" TEXT NOT NULL,
    "images" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "corePromptId" TEXT,
    "chatgptOutput" TEXT NOT NULL DEFAULT '',
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "views" INTEGER,
    "viewsUpdatedAt" DATETIME,
    CONSTRAINT "PromptEntry_corePromptId_fkey" FOREIGN KEY ("corePromptId") REFERENCES "CorePrompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PromptEntry" ("createdAt", "extraNotes", "id", "images", "productInfo", "productName", "riskModule") SELECT "createdAt", "extraNotes", "id", "images", "productInfo", "productName", "riskModule" FROM "PromptEntry";
DROP TABLE "PromptEntry";
ALTER TABLE "new_PromptEntry" RENAME TO "PromptEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
