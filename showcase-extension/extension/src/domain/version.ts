/** Schema ของ normalized product ตาม spec §8.1 — เปลี่ยนได้เฉพาะเมื่อตั้งใจ มี test ล็อกไว้ */
export const SCHEMA_VERSION = 1 as const

/** Adapter ที่อ่านจาก fixture สังเคราะห์ล้วน ไม่มี network */
export const ADAPTER_VERSION_MOCK = 'mock-v0' as const

/** Adapter ที่คุยกับ TikTok จริง (extension/src/adapters/live-showcase.ts) */
export const ADAPTER_VERSION_LIVE = 'live-v1' as const

/*
 * ────────────────────────────────────────────────────────────────────────────
 * Gate — แยกสามเรื่องที่เคยปนกันอยู่ใน G0_VERIFIED ตัวเดียว (2026-09-20 รอบที่สี่)
 *
 * เดิม `G0_VERIFIED` ถูกใช้ตอบคำถามสามข้อพร้อมกัน ทำให้ขยับอะไรไม่ได้เลยถ้าข้อใดข้อหนึ่งยังไม่ผ่าน
 * ตอนนี้แยกเป็นสามค่าที่ตอบคนละคำถาม และไม่มีค่าใดอนุมานค่าอื่นได้เอง:
 *
 *   1. หลักฐานทางเทคนิคครบหรือยัง            → G0_TECHNICAL_EVIDENCE_COMPLETE
 *   2. เจ้าของโปรเจกต์อนุญาตให้ทดลองหรือยัง   → OWNER_MANUAL_PROBE_AUTHORIZED
 *   3. TikTok อนุญาตให้เข้าถึงอัตโนมัติหรือยัง → TIKTOK_AUTOMATED_ACCESS_AUTHORIZED
 *
 * `G0_VERIFIED` ยังอยู่และยังเป็น false — เป็น gate รวมของ **full scan** เท่านั้น
 * ทั้งหมดนี้เป็นค่าคงที่ระดับ compile time ไม่มี runtime override / debug switch / query string /
 * storage key ใดเปลี่ยนได้ การเปลี่ยนต้องแก้ไฟล์นี้แล้ว commit เท่านั้น
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * (1) หลักฐานทางเทคนิคของ G0 (spec §5.3 ข้อ 1–5) ครบแล้ว — endpoint/method, fixture ครบ 3 หน้า,
 * page size + วิธีเลื่อน offset, ลักษณะ Product ID ก่อน parse, และ field ที่เก็บ/ส่งออก
 * ดูหลักฐานทั้งหมดใน docs/api-observations.md §1–§3
 */
export const G0_TECHNICAL_EVIDENCE_COMPLETE = true as const

/**
 * (2) เจ้าของโปรเจกต์อนุญาตให้ทดลองอ่าน **หนึ่งหน้า แบบ manual บนบัญชีของตนเอง** ในรอบนี้
 *
 * ขอบเขตที่อนุญาต: ผู้ใช้เป็นผู้ล็อกอินเอง กดให้สิทธิ์ host เอง และกดปุ่มทดสอบเอง → ยิง GET
 * หนึ่งครั้งที่ offset=0&count=6 เท่านั้น ไม่มี pagination / retry / polling / การเริ่มเอง
 *
 * **ไม่ใช่** การยืนยันว่า TikTok อนุญาต (ดูข้อ 3) และ**ไม่ใช่** debug bypass — เป็นการเปลี่ยน
 * ขอบเขตที่บันทึกไว้ชัดเจนใน docs/api-observations.md §7
 */
export const OWNER_MANUAL_PROBE_AUTHORIZED = true as const

/**
 * (2ข) เจ้าของโปรเจกต์อนุญาตให้ทดลองอ่าน **หลายหน้าจนจบ Showcase แบบ manual บนบัญชีของตนเอง**
 * (2026-09-20 รอบที่หก — ขยายขอบเขตจากข้อ (2) หลังการทดลองหนึ่งหน้าสำเร็จ)
 *
 * ขอบเขตที่อนุญาต: ผู้ใช้เป็นผู้ล็อกอินเอง กดให้สิทธิ์ host เอง และกดปุ่ม "ดึงข้อมูล" เอง → runner
 * เลื่อน offset ทีละ `count=6` จนถึงจุดจบที่ `data.total` บอก แล้วหยุด มี retry/backoff ตามนโยบายเดิม
 *
 * ขอบเขตที่ **ไม่** รวม: การเริ่มเอง (ไม่มี alarm/polling/auto-resume), การรันเบื้องหลังโดยผู้ใช้
 * ไม่ได้สั่ง, count อื่นนอกจาก 6, และ endpoint อื่นนอกจากที่มี observed evidence
 *
 * แยกจากข้อ (2) เป็นคนละค่า ไม่ใช่การขยายความหมายของค่าเดิม เพื่อให้ปิดการทดลองหลายหน้ากลับได้
 * โดยไม่กระทบการทดลองหนึ่งหน้า และเพื่อให้เอกสารอ้างถึงการอนุญาตสองเรื่องนี้แยกกันได้
 *
 * **ไม่ใช่** การยืนยันว่า TikTok อนุญาต (ดูข้อ 3) ดู docs/api-observations.md §7
 */
export const OWNER_MANUAL_SCAN_AUTHORIZED = true as const

/**
 * (3) TikTok อนุญาตให้เข้าถึงแบบอัตโนมัติหรือยัง — **ยังไม่** (2026-09-20)
 *
 * TikTok Shop Creator Terms of Use (Thailand) §8/§12 ห้าม automated access
 * "unless you have our express written permission to do so" ซึ่งยังไม่ได้ขอและยังไม่ได้รับ
 * ดูข้อความอ้างอิงและที่มาใน docs/api-observations.md §3.1
 *
 * ค่านี้เปลี่ยนเป็น true ได้ก็ต่อเมื่อมีหนังสืออนุญาตจริงจาก TikTok เท่านั้น
 */
export const TIKTOK_AUTOMATED_ACCESS_AUTHORIZED = false as const

/**
 * G0 gate รวม — ใช้เป็นเงื่อนไขของ **full scan (run.start)** เท่านั้น
 * ยังเป็น false เพราะข้อ (3) ยังไม่ผ่าน — ห้ามเปลี่ยนเป็น true เพื่ออ้างว่าทุกข้อผ่าน
 */
export const G0_VERIFIED = false as const
