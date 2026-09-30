-- CreateTable
CREATE TABLE "FlowActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "jobId" TEXT NOT NULL DEFAULT '',
    "round" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE INDEX "FlowActivity_at_idx" ON "FlowActivity"("at");

-- CreateIndex
CREATE INDEX "FlowActivity_kind_at_idx" ON "FlowActivity"("kind", "at");
