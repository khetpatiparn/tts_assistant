/*
  Warnings:

  - You are about to drop the column `views` on the `PromptEntry` table. All the data in the column will be lost.
  - You are about to drop the column `viewsUpdatedAt` on the `PromptEntry` table. All the data in the column will be lost.

*/
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
    "postedAt" DATETIME,
    CONSTRAINT "PromptEntry_corePromptId_fkey" FOREIGN KEY ("corePromptId") REFERENCES "CorePrompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PromptEntry" ("chatgptOutput", "corePromptId", "createdAt", "extraNotes", "id", "images", "postedAt", "productInfo", "productName", "riskModule", "videoUrl") SELECT "chatgptOutput", "corePromptId", "createdAt", "extraNotes", "id", "images", "postedAt", "productInfo", "productName", "riskModule", "videoUrl" FROM "PromptEntry";
DROP TABLE "PromptEntry";
ALTER TABLE "new_PromptEntry" RENAME TO "PromptEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
