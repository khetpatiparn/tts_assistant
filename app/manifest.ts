import type { MetadataRoute } from "next";

/**
 * ทำให้ติดตั้งเป็นแอปได้ (PWA) — Chrome/Edge: ไอคอน "ติดตั้ง" ท้ายแถบ URL (หรือเมนู ⋮) แล้วแอปจะ
 * เปิดเป็นหน้าต่างของตัวเองจากไอคอนบน taskbar · เลือกทางนี้แทน desktop app (Electron) เมื่อ
 * 2026-09-29 เพราะได้หน้าต่างแยก/ไอคอน/ตัวเลขบนไอคอนเหมือนกัน โดยไม่ต้องแพ็ก Next + better-sqlite3
 * + บอท Flow ใหม่ทุกครั้งที่แก้โค้ด และยังเปิดจากมือถือได้ในอนาคต
 *
 * ไม่มี service worker โดยตั้งใจ — แอปนี้ใช้ไม่ได้อยู่แล้วถ้า server (start.bat) ไม่เปิด cache
 * ออฟไลน์จะได้แค่หน้าเก่าที่กดอะไรไม่ได้ · สีคือ --navy-900 (พื้นธีมมืดซึ่งเป็นค่าเริ่มต้น) แปลงเป็น
 * hex เพราะ manifest ไม่รองรับ oklch · ไอคอนใน public/icons/ วาดจาก Compass ของ app-header.tsx
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Angle — ประกอบ Core Prompt สำหรับวิดีโอ TikTok Shop",
    short_name: "Angle",
    description: "by LAGR — ประกอบ Core Prompt สำหรับสร้างวิดีโอ TikTok Shop ด้วย Gemini Flow",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0e141c",
    theme_color: "#0e141c",
    icons: [
      { src: "/icons/angle-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/angle-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/angle-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
