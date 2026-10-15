-- AlterTable
ALTER TABLE "FlowJob" ADD COLUMN "extraPrompt" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "FlowJobImage" ADD COLUMN "promptExtra" TEXT NOT NULL DEFAULT '';
