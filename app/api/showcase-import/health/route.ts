import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SHOWCASE_CORS_HEADERS } from "@/lib/cors";

/**
 * ให้ popup ของ showcase-extension เช็คก่อนเปิดปุ่ม "สแกนสินค้าใหม่ → ส่งเข้า Angle" ว่า
 * (1) แอปเปิดอยู่ (ตอบได้ = เปิด) (2) รหัสเชื่อมต่อที่บันทึกไว้ถูกไหม — ส่ง header x-showcase-secret
 * มาด้วยจะได้ `secretOk` true/false (ไม่ส่ง = null) กันผู้ใช้สแกนจบแล้วไปรู้ตอนส่งว่ารหัสผิด
 * (3) "นำเข้าล่าสุด" สำหรับโชว์บน popup
 *
 * ไม่เปิดเผยอะไรเพิ่มจาก POST ../route.ts — ที่นั่นก็บอกผลถูก/ผิดของ secret ผ่าน 401 อยู่แล้ว ส่วน
 * จำนวนสินค้า/เวลานำเข้าไม่ใช่ความลับ (ดูเหตุผลเดียวกันที่ ../known-ids/route.ts) · ต้องมี CORS ทั้ง
 * OPTIONS และ response จริง เหตุผลเต็มที่ lib/cors.ts (เดิม endpoint นี้ไม่มี CORS เลยจึงใช้จาก
 * extension ไม่ได้จริงมาตั้งแต่สร้าง)
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: SHOWCASE_CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-showcase-secret");
  const expected = process.env.SHOWCASE_IMPORT_SECRET;
  const secretOk = secret === null ? null : Boolean(expected) && secret === expected;

  const [products, lastBatch] = await Promise.all([
    prisma.productCandidate.findMany({
      where: { sourceProductId: { not: null } },
      select: { sourceProductId: true },
      distinct: ["sourceProductId"],
    }),
    prisma.candidateBatch.findFirst({
      where: { rows: { some: { sourceProductId: { not: null } } } },
      orderBy: { capturedOn: "desc" },
      select: { capturedOn: true },
    }),
  ]);

  return NextResponse.json(
    {
      ok: true,
      service: "pooling_prompt",
      secretOk,
      productCount: products.length,
      lastImportAt: lastBatch?.capturedOn.toISOString() ?? null,
    },
    { status: 200, headers: SHOWCASE_CORS_HEADERS }
  );
}
