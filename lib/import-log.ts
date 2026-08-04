/**
 * ชนิดไฟล์ที่นำเข้าได้ — ตรงกับคอลัมน์ kind ใน ImportLog
 *
 * ไฟล์นี้ถูก import โดย client component ด้วย **ห้ามใส่ import จาก node:* เด็ดขาด**
 * (การ hash ไฟล์อยู่ใน app/actions.ts ซึ่งเป็นฝั่ง server ล้วน)
 */
export type ImportKind = "orders" | "clips";

/** จำนวนไฟล์ Content.csv ที่ควรอัปต่อรอบ (ช่วง 7 + 28 + 60 วัน) */
export const EXPECTED_CLIP_FILES = 3;

/** รับ shape แคบๆ ไม่ผูกกับ Prisma เพื่อให้ทดสอบง่าย */
export type ImportLogRecord = {
  kind: string;
  uploadedAt: Date;
  rowCount: number;
  summary: string;
};

export type RoundFile = {
  uploadedAt: Date;
  rowCount: number;
  summary: string;
};

export type RoundSummary = {
  kind: string;
  /** ไฟล์ที่อัปในวันล่าสุดของชนิดนี้ เรียงเก่า→ใหม่ */
  files: RoundFile[];
};

/**
 * คีย์วันตามปฏิทิน — uploadedAt เป็น timestamp จริง (ไม่ใช่ UTC midnight แบบ postedAt/statsOn)
 * จึงต้องอ่านด้วย local getter เหมือน orderDate ใน lib/dashboard.ts
 *
 * ใช้ UTC getter แล้วการอัปช่วงเช้าตรู่เวลาไทย (ก่อน 07:00 = ยังเป็นเมื่อวานตาม UTC)
 * จะถูกจัดไปคนละวันกับการอัปตอนบ่ายของวันเดียวกัน
 */
function dayKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * จัดกลุ่ม log ตามชนิดไฟล์ แล้วเก็บเฉพาะรายการของ "วันล่าสุดที่ชนิดนั้นมีการอัป"
 *
 * ยึดวันล่าสุด "ต่อชนิด" ไม่ใช่วันล่าสุดรวม เพราะแต่ละไฟล์มีรอบไม่เท่ากัน
 * ถ้ายึดวันล่าสุดรวมจะเห็นแค่ชนิดที่เพิ่งอัป
 *
 * วิธีนี้ครอบทั้งกรณีอัป 3 ไฟล์ในการกดครั้งเดียว และกรณีกด 3 ครั้งแยกกันในวันเดียวกัน
 * โดยไม่ต้องรู้ว่าเป็นแบบไหน
 */
export function groupLatestRound(logs: ImportLogRecord[]): RoundSummary[] {
  const byKind = new Map<string, ImportLogRecord[]>();
  for (const l of logs) {
    const list = byKind.get(l.kind);
    if (list) list.push(l);
    else byKind.set(l.kind, [l]);
  }

  const out: RoundSummary[] = [];
  for (const [kind, list] of byKind) {
    const latestKey = dayKeyLocal(
      new Date(Math.max(...list.map((l) => l.uploadedAt.getTime())))
    );
    const files = list
      .filter((l) => dayKeyLocal(l.uploadedAt) === latestKey)
      .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
      .map((l) => ({
        uploadedAt: l.uploadedAt,
        rowCount: l.rowCount,
        summary: l.summary,
      }));
    out.push({ kind, files });
  }
  return out;
}
