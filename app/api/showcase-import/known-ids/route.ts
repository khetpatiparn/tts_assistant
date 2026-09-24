import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * ให้ showcase-extension ถามว่า sourceProductId ไหนเคย import เข้าระบบแล้วบ้าง เพื่อให้การสแกน
 * รอบใหม่หยุดได้เองทันทีที่เจอหน้าที่มีแต่สินค้าที่รู้จักอยู่แล้วทั้งหน้า (ดู showcase-extension
 * core/runner.ts stopReason 'known_ids_reached')
 *
 * ไม่ต้องเช็ก x-showcase-secret เหมือน ../route.ts (POST) — ที่นั่นป้องกันเพราะรับข้อมูลจากภายนอกมา
 * เขียนเข้า DB ได้ (integrity risk) ส่วนนี่เป็น GET อ่านอย่างเดียว คืนแค่รายการ product ID ซึ่งเป็น
 * ข้อมูลที่มองเห็นได้อยู่แล้วจากหน้า Showcase สาธารณะของร้านเอง จึงไม่มี confidentiality เพิ่มที่ต้อง
 * ป้องกัน (รูปแบบเดียวกับ ../health/route.ts ที่ไม่มี secret เช่นกัน)
 */
export async function GET() {
  const rows = await prisma.productCandidate.findMany({
    where: { sourceProductId: { not: null } },
    select: { sourceProductId: true },
    distinct: ["sourceProductId"],
  });

  const productIds = rows
    .map((row) => row.sourceProductId)
    .filter((id): id is string => id !== null);

  return NextResponse.json({ productIds }, { status: 200 });
}
