import { createMockShowcaseAdapter } from './mock-showcase.js'
import type { AdapterPurpose, ShowcaseAdapter } from './types.js'

/**
 * mock channel ไม่มี gate เพราะไม่มี network ให้ gate ตั้งแต่แรก — รับ `purpose` ไว้ให้ signature
 * ตรงกับ resolve.live.ts (background.ts เรียกผ่าน `#adapter` alias เดียวกันทั้งสอง channel)
 */
export function resolveAdapter(_purpose: AdapterPurpose = 'full_scan'): ShowcaseAdapter {
  return createMockShowcaseAdapter()
}
