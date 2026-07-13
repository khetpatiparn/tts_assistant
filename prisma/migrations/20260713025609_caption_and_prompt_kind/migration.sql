-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CorePrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'core',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CorePrompt" ("content", "createdAt", "id", "isActive", "label") SELECT "content", "createdAt", "id", "isActive", "label" FROM "CorePrompt";
DROP TABLE "CorePrompt";
ALTER TABLE "new_CorePrompt" RENAME TO "CorePrompt";
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
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PromptEntry_corePromptId_fkey" FOREIGN KEY ("corePromptId") REFERENCES "CorePrompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PromptEntry" ("chatgptOutput", "corePromptId", "createdAt", "extraNotes", "id", "images", "postedAt", "productInfo", "productName", "riskModule", "videoUrl") SELECT "chatgptOutput", "corePromptId", "createdAt", "extraNotes", "id", "images", "postedAt", "productInfo", "productName", "riskModule", "videoUrl" FROM "PromptEntry";
DROP TABLE "PromptEntry";
ALTER TABLE "new_PromptEntry" RENAME TO "PromptEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
