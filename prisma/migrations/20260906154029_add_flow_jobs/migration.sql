-- CreateTable
CREATE TABLE "FlowJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "flowProjectId" TEXT NOT NULL DEFAULT '',
    "failedStep" TEXT NOT NULL DEFAULT '',
    "errorKind" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "failureDir" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "FlowJob_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "PromptEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FlowJobImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "index" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowJobImage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "FlowJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FlowWorkerState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastSeenAt" DATETIME,
    "currentJobId" TEXT,
    "pausedReason" TEXT NOT NULL DEFAULT '',
    "pausedAt" DATETIME,
    "todayDate" TEXT NOT NULL DEFAULT '',
    "todayBatches" INTEGER NOT NULL DEFAULT 0,
    "sessionStreak" INTEGER NOT NULL DEFAULT 0,
    "nextWakeAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "FlowJob_status_idx" ON "FlowJob"("status");

-- CreateIndex
CREATE INDEX "FlowJob_entryId_idx" ON "FlowJob"("entryId");

-- CreateIndex
CREATE INDEX "FlowJobImage_jobId_idx" ON "FlowJobImage"("jobId");
