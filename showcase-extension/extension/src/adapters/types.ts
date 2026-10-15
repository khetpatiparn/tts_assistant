export interface ShowcasePageRequest {
  readonly offset: number
  readonly count: number
}

/**
 * bodyText เป็นข้อความดิบโดยเจตนา ไม่ผ่าน JSON.parse
 * V03 ต้อง lossless-parse Product ID ที่อาจมาเป็นตัวเลขไม่ใส่ quotes —
 * ถ้า adapter parse ให้ก่อน precision จะหายไปแล้วกู้คืนไม่ได้
 */
export interface ShowcaseRawPage {
  readonly httpStatus: number
  readonly headers: Readonly<Record<string, string>>
  readonly bodyText: string
}

export interface ShowcaseAdapter {
  readonly adapterVersion: string
  readonly mode: 'mock' | 'live'
  fetchPage(request: ShowcasePageRequest, signal: AbortSignal): Promise<ShowcaseRawPage>
}

/**
 * จะเอา adapter ไปทำอะไร — ใช้เป็นเงื่อนไขของ gate ใน resolve.live.ts
 * (mock channel ไม่สนใจค่านี้เพราะไม่มี network ให้ gate ตั้งแต่แรก)
 *
 * - `metadata_only` — แค่ต้องการรู้ channel/เวอร์ชัน ไม่ยิง request เลย
 * - `manual_probe`  — ทดลองอ่านหนึ่งหน้าที่ผู้ใช้กดเอง (spec §14.1)
 * - `manual_scan`   — ผู้ใช้กดเองเพื่อสแกนหลายหน้าจนจบ ผ่าน runImport (ทดลอง ไม่ใช่โหมดปกติ)
 * - `full_scan`     — สแกนทั้ง Showcase แบบ live-ready เต็มรูปแบบ (ยังไม่เปิดในรุ่นนี้)
 *
 * `manual_scan` กับ `full_scan` อ่านข้อมูลชุดเดียวกัน ต่างกันที่ **เงื่อนไขการอนุญาต**:
 * `manual_scan` อาศัยการอนุญาตของเจ้าของโปรเจกต์บนบัญชีตนเองเท่านั้น ส่วน `full_scan`
 * ต้องรอ `G0_VERIFIED` ซึ่งรวมการอนุญาตจาก TikTok ที่ยังไม่มี
 */
export type AdapterPurpose = 'metadata_only' | 'manual_probe' | 'manual_scan' | 'full_scan'
