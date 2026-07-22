-- CreateTable
CREATE TABLE "FollowerActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityOn" DATETIME NOT NULL,
    "hour" INTEGER NOT NULL,
    "active" INTEGER NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "postedAt" DATETIME,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT NOT NULL DEFAULT '',
    "postedTimeOfDay" TEXT,
    "postedTimeSource" TEXT,
    "isScheduledPost" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PromptEntry_corePromptId_fkey" FOREIGN KEY ("corePromptId") REFERENCES "CorePrompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PromptEntry" ("caption", "chatgptOutput", "corePromptId", "createdAt", "extraNotes", "hashtags", "id", "images", "postedAt", "postedTimeOfDay", "productInfo", "productName", "riskModule", "videoUrl") SELECT "caption", "chatgptOutput", "corePromptId", "createdAt", "extraNotes", "hashtags", "id", "images", "postedAt", "postedTimeOfDay", "productInfo", "productName", "riskModule", "videoUrl" FROM "PromptEntry";
DROP TABLE "PromptEntry";
ALTER TABLE "new_PromptEntry" RENAME TO "PromptEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "FollowerActivity_activityOn_hour_key" ON "FollowerActivity"("activityOn", "hour");
