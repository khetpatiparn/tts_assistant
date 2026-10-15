import type { NextConfig } from "next";
import { getRuntimePaths } from "./lib/runtime-paths";

// Validate before accepting any request, including a test DB with production storage.
const runtime = getRuntimePaths();
if (runtime.sandboxRoot && process.env.NEXT_DIST_DIR !== ".next-dev") {
  throw new Error("Sandbox requires NEXT_DIST_DIR=.next-dev; production .next must not be shared.");
}

const nextConfig: NextConfig = {
  // ปกติคือ ".next" — แต่ให้ override ผ่าน env ได้ เพื่อให้ dev server ของ agent
  // (NEXT_DIST_DIR=.next-dev) กับ production server ที่ผู้ใช้เปิดด้วย start.bat
  // เขียนคนละโฟลเดอร์ ไม่ทับกันจนพัง — ผู้ใช้จะได้ใช้แอปทำคลิปต่อได้ระหว่างที่ยังพัฒนาอยู่
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // uploads/ คือไฟล์ที่ผู้ใช้อัปตอนรันจริง (รูปสินค้า/รูปจาก Flow ~3,700 ไฟล์ 400+ MB) ไม่ใช่ของที่
  // route ต้องพกไปด้วย — ไม่ตัดออก ตัว trace จะลากทั้งโฟลเดอร์เข้าไปในทุก route ที่ import actions
  outputFileTracingExcludes: {
    "/*": ["./uploads/**/*", "./.scratch/**/*"],
  },
  experimental: {
    serverActions: {
      // Product photos are uploaded through a Server Action, and the default cap
      // is 1MB for the whole request — a single phone photo blows past it. This
      // covers a batch of several files at the 10MB per-file cap enforced in
      // uploadProductImages(), plus multipart overhead.
      bodySizeLimit: "32mb",
    },
  },
  // จำกัดให้ optimizer ย่อได้เฉพาะรูปสินค้า — ถ้าไม่ตั้ง จะยอมทุก local path ซึ่งเปิดช่อง
  // ให้ถูกใช้เป็น proxy ย่อรูปอะไรก็ได้ในเว็บ (ดู image.md หัวข้อ localPatterns)
  // URL ของเราไม่มี query string จึงตั้ง search เป็นค่าว่างได้
  images: {
    localPatterns: [{ pathname: "/api/uploads/**", search: "" }],
  },
};

export default nextConfig;
