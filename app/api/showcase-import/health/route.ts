import { NextResponse } from "next/server";

/** ping เบาๆ ให้ extension เช็คว่า pooling_prompt server เปิดอยู่ก่อนเปิดปุ่ม "ส่ง" */
export async function GET() {
  return NextResponse.json({ ok: true, service: "pooling_prompt" }, { status: 200 });
}
