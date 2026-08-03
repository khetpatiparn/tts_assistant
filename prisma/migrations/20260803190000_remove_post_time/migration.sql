-- ตัดฟีเจอร์ "เวลาโพสต์ vs วิว" ทิ้ง: ข้อมูลวิวจาก Content.csv ถูกตัดเหลือท็อป 15
-- จึงมี selection bias จนวิเคราะห์เวลาโพสต์ไม่ได้จริง

-- log ของไฟล์ FollowerActivity.csv ที่เคยอัป (ชนิดนี้ไม่มีที่ให้แสดงอีกแล้ว)
DELETE FROM "ImportLog" WHERE "kind" = 'followers';

DROP TABLE "FollowerActivity";

ALTER TABLE "PromptEntry" DROP COLUMN "postedTimeOfDay";
ALTER TABLE "PromptEntry" DROP COLUMN "postedTimeSource";
ALTER TABLE "PromptEntry" DROP COLUMN "isScheduledPost";
