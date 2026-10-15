-- AlterTable
ALTER TABLE "FlowWorkerState" ADD COLUMN "todayRenders" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FlowJobImage" ADD COLUMN "flowMediaId" TEXT NOT NULL DEFAULT '';
