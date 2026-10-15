-- AlterTable
-- คอลัมน์ใหม่มีค่าดีฟอลต์ จึงเติมให้แถวเดิมทั้งหมดได้โดยไม่ต้องสร้างตารางใหม่
ALTER TABLE "PromptEntry" ADD COLUMN "safeMode" BOOLEAN NOT NULL DEFAULT false;
