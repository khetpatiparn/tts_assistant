import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ปกติคือ ".next" — แต่ให้ override ผ่าน env ได้ เพื่อให้ dev server ของ agent
  // (NEXT_DIST_DIR=.next-dev) กับ production server ที่ผู้ใช้เปิดด้วย start.bat
  // เขียนคนละโฟลเดอร์ ไม่ทับกันจนพัง — ผู้ใช้จะได้ใช้แอปทำคลิปต่อได้ระหว่างที่ยังพัฒนาอยู่
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // Product photos are uploaded through a Server Action, and the default cap
      // is 1MB for the whole request — a single phone photo blows past it. This
      // covers a batch of several files at the 10MB per-file cap enforced in
      // uploadProductImages(), plus multipart overhead.
      bodySizeLimit: "32mb",
    },
  },
};

export default nextConfig;
