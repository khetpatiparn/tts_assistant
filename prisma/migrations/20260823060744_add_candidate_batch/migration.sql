-- CreateTable
CREATE TABLE "CandidateBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capturedOn" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CandidateBatch_capturedOn_idx" ON "CandidateBatch"("capturedOn");

-- ย้ายข้อมูลเดิม: 1 ชุดต่อ 1 "วันเวลาไทย" ที่เคยเก็บ
--
-- capturedOn เก็บเป็น TEXT ISO 8601 (เช่น "2026-08-20T05:50:43.452+00:00") ไม่ใช่ integer
-- SQLite จึง parse ตรงได้เลย ห้ามใช้สูตร unixepoch (ลองแล้วได้ 1970-01-01 ทุกแถว)
--
-- '+7 hours' = ตัดวันตามเวลาไทย ไม่ใช่ UTC — บั๊กคลาสเดียวกับ toDateInputValue/
-- toLocalDateInputValue ใน production-panel.tsx ถ้าตัดด้วย UTC การอัปก่อน 7 โมงเช้า
-- จะถูกจัดเข้าวันก่อนหน้า
--
-- วัดกับข้อมูลจริงแล้ว (2026-08-23): ได้ 4 ชุด (18, 19, 20, 23 ส.ค.) รวม 162 แถว
-- และไม่มี nameKey ซ้ำภายในวันเดียวกันเลย จึงไม่ชน @@unique([batchId, nameKey])
INSERT INTO "CandidateBatch" ("id", "capturedOn", "createdAt")
SELECT
    'legacy-' || DATE("capturedOn", '+7 hours'),
    MIN("capturedOn"),
    CURRENT_TIMESTAMP
FROM "ProductCandidate"
GROUP BY DATE("capturedOn", '+7 hours');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "commission" REAL NOT NULL,
    "weeklySales" INTEGER,
    "categoryLabel" TEXT NOT NULL,
    "capturedOn" DATETIME NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "linkedEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CandidateBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductCandidate" ("id", "batchId", "name", "nameKey", "price", "commission", "weeklySales", "categoryLabel", "capturedOn", "note", "linkedEntryId", "createdAt")
SELECT
    "id",
    'legacy-' || DATE("capturedOn", '+7 hours'),
    "name",
    "nameKey",
    "price",
    "commission",
    "weeklySales",
    "categoryLabel",
    "capturedOn",
    "note",
    "linkedEntryId",
    "createdAt"
FROM "ProductCandidate";
DROP TABLE "ProductCandidate";
ALTER TABLE "new_ProductCandidate" RENAME TO "ProductCandidate";
CREATE UNIQUE INDEX "ProductCandidate_batchId_nameKey_key" ON "ProductCandidate"("batchId", "nameKey");
CREATE INDEX "ProductCandidate_categoryLabel_idx" ON "ProductCandidate"("categoryLabel");
CREATE INDEX "ProductCandidate_batchId_idx" ON "ProductCandidate"("batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
