# Showcase Scanner Destination Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Showcase Scanner ส่งผลสแกนไปที่ "ลิงก์ปลายทาง" ลิงก์เดียว (protocol `showcase-scanner/1`) แทนการผูกกับ Angle ผ่าน secret header — แจกคนรู้จักเป็น zip ได้ และ Angle ใช้ลิงก์แบบเดียวกัน

**Architecture:** extension ได้โมดูลเดียว `dashboard/destination.ts` ที่รู้จัก protocol (ตรวจลิงก์, GET สถานะ/สินค้าที่มีแล้ว, POST ส่งผล, ความจำ "ส่งแล้ว") ใช้ร่วมกันโดย popup และหน้าจัดการ · Angle ได้ route เดียว `app/api/scanner` ตรวจ token จาก query เทียบกับแถว singleton ใน DB · สิทธิ์ TikTok ย้ายไปขอตอนติดตั้ง ปลายทางไม่ต้องใช้สิทธิ์ (อาศัย CORS — ยืนยันสดแล้ว)

**Tech Stack:** Chrome MV3 + TypeScript + esbuild + vitest + Playwright (extension, `showcase-extension/`) · Next.js 16.2.10 custom + Prisma 7/SQLite (Angle, root)

**Spec:** `docs/superpowers/specs/2026-09-29-showcase-destination-link-design.md` · ADR: `docs/adr/0001-destination-link-secret-in-url.md` · คำศัพท์: `CONTEXT.md`

## Global Constraints

- Protocol id ตายตัว: `showcase-scanner/1`
- POST ต้องเป็น `Content-Type: text/plain;charset=utf-8` และ**ห้ามมี custom header** (simple request — ไม่มี preflight, ใช้กับ Google Apps Script ได้)
- ลิงก์ปลายทาง: https บังคับ ยกเว้น host `localhost` หรือ `127.0.0.1` (http ได้)
- ทุก response ของปลายทาง Angle ต้องมี `Access-Control-Allow-Origin: *`
- Extension: ห้ามทำให้ PK tests อ่อนลง — ห้าม `location.search`/`URLSearchParams`, ห้าม `onMessageExternal`, ห้าม `chrome.storage.sync`, ห้าม wildcard host กว้าง (`https://*/*`, `<all_urls>` ฯลฯ), `permissions` = `["storage"]` เท่านั้น
- Extension เก็บค่าที่ `chrome.storage.local` เท่านั้น: `destinationLink` (string), `deliveredProductIds` (string[]), `lastDeliveredAt` (ISO string)
- ข้อความ UI ภาษาไทย · Angle UI: ห้าม `text-[...]`, ห้าม hex ใน `components/*`, ปุ่ม `h-11 lg:h-9`, รัน `node scripts/check-contrast.mjs` · 1440px คือ checkpoint บังคับ
- Angle: ห้ามรัน `npm run build`/`dev` บน `.next` ขณะ server ผู้ใช้เปิด — ใช้ `npx tsc --noEmit`, `npm run lint`, และ dev server แยก `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` · หลังรัน dev ให้ `git checkout -- tsconfig.json` ถ้าถูกแก้
- Angle DB: ห้ามแตะ `dev.db` จริงจนถึง Task 9 · backup ก่อน migrate ต้อง checkpoint WAL + ก๊อป 3 ไฟล์ · ห้าม `prisma migrate dev` กับ `dev.db` จริง (ถ้าเจอ drift มันเสนอ reset = ข้อมูลหาย) ใช้ `migrate deploy` เท่านั้น
- ทุก commit ลงท้าย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. ผู้ใช้วางลิงก์มีช่องว่างหัวท้าย / เป็น http ไปเครื่องอื่น / ไม่ใช่ URL → ต้องได้ข้อความบอกเหตุผลเป็นไทย ไม่บันทึก (Task 1 เทส `parseDestinationLink`)
2. เจ้าของกด "สร้างลิงก์ใหม่" ใน Angle แต่ extension ยังถือลิงก์เก่า → popup ไฟแดง "ลิงก์ใช้ไม่ได้แล้ว" และโหมดอัตโนมัติไม่สแกน (Task 1 เทส 401 → `rejected`; Task 6 เทส regenerate ทำให้ token เก่าได้ 401)
3. ปลายทางแบบ Apps Script ตอบ GET เป็น HTML 200 และตอบ POST เป็นข้อความไม่ใช่ JSON → ไฟเทา "ไม่บอกสถานะ" และการส่งยังนับว่าสำเร็จ (Task 1 เทส)
4. สินค้าที่ TikTok บอกว่าตายแล้ว (`hasStatusPopup`) ปนอยู่ในหน้าที่เหลือเป็นสินค้าที่ส่งแล้วทั้งหมด → ยังต้องนับเป็นหน้าที่รู้จักแล้วและหยุดสแกน (Task 2 เทส runner)
5. ใช้ครั้งแรก ความจำว่าง และปลายทางไม่รองรับ GET → สแกนจนจบแล้วส่งทุกตัว (ถูกต้อง เพราะยังไม่เคยส่งอะไร) แต่ถ้าปลายทาง "ติดต่อไม่ได้" ต้องไม่สแกนเลย (Task 1 เทส `resolveKnownIds`)

---

## File Structure

**Extension (`showcase-extension/`)**
- Create `extension/src/dashboard/destination.ts` — protocol client ตัวเดียว (แทน `app-link.ts` ที่ลบทิ้ง)
- Create `tests/unit/destination.test.ts` (แทน `tests/unit/app-link.test.ts` ที่ลบทิ้ง)
- Modify `extension/src/export/json.ts` — เพิ่ม `protocol`
- Modify `extension/src/core/runner.ts:492` — สินค้าตายนับเป็นรู้จักแล้ว
- Modify `extension/manifest.json`, `extension/src/domain/permissions.ts`, `tests/unit/pk01-manifest.test.ts`
- Rewrite `extension/src/dashboard/index.html`, modify `extension/src/dashboard/main.ts`, `dashboard.css`
- Rewrite `extension/src/popup/index.html`, `extension/src/popup/main.ts`, modify `popup.css`
- Modify `tests/e2e/load-unpacked.spec.ts`
- Create `docs/INTEGRATION.md`, `docs/INSTALL.md`, `docs/examples/apps-script.gs`, `docs/examples/express.js`, `docs/examples/nextjs-route.ts`
- Create `scripts/package.mjs`, modify `package.json` (script `package`)

**Angle (root)**
- Modify `prisma/schema.prisma` + create `prisma/migrations/20260929120000_add_scanner_link/migration.sql`
- Create `lib/scanner-link.ts` (token + ตรวจ token), `scripts/check-scanner-link.mjs`
- Create `app/api/scanner/route.ts`
- Delete `app/api/showcase-import/route.ts`, `app/api/showcase-import/known-ids/route.ts`, `app/api/showcase-import/health/route.ts`
- Modify `lib/cors.ts`, `app/actions.ts` (actions ลิงก์), `components/candidates-route.tsx` + create `components/scanner-link-box.tsx`, `app/products/page.tsx`
- Modify `CLAUDE.md`

---

### Task 1: Extension — protocol client `destination.ts`

**Files:**
- Create: `showcase-extension/extension/src/dashboard/destination.ts`
- Create: `showcase-extension/tests/unit/destination.test.ts`
- Delete: `showcase-extension/extension/src/dashboard/app-link.ts`, `showcase-extension/tests/unit/app-link.test.ts` (popup/main.ts และ dashboard/main.ts ยัง import อยู่ — Task 4/5 เปลี่ยน import; ใน task นี้ให้ `app-link.ts` คงไว้จนกว่า Task 4/5 ลบ import ออก แล้วค่อยลบใน Task 5 step สุดท้าย)

**Interfaces:**
- Produces:
  - `export const PROTOCOL = 'showcase-scanner/1'`
  - `parseDestinationLink(raw: string): { ok: true; url: string } | { ok: false; message: string }`
  - `interface DestinationDeps { fetchImpl: typeof fetch; storageGet(keys: string[]): Promise<Record<string, unknown>>; storageSet(items: Record<string, unknown>): Promise<void>; now(): number }`
  - `defaultDestinationDeps(): DestinationDeps` (ใช้ `chrome.storage.local`, `fetch`, `Date.now`)
  - `getDestinationLink(deps?): Promise<string>` · `saveDestinationLink(url: string, deps?): Promise<void>` (ล้างความจำด้วย เพราะเปลี่ยนปลายทาง = ความจำเดิมไม่เกี่ยว)
  - `getDeliveryMemory(deps?): Promise<{ ids: string[]; lastDeliveredAt: string | null }>` · `clearDeliveryMemory(deps?): Promise<void>`
  - `type DestinationStatus = { kind: 'no_link' } | { kind: 'unreachable' } | { kind: 'rejected' } | { kind: 'ready'; productCount: number; lastReceivedAt: string | null } | { kind: 'no_status'; lastDeliveredAt: string | null }`
  - `checkDestination(deps?): Promise<DestinationStatus>`
  - `resolveKnownIds(deps?): Promise<{ source: 'destination' | 'memory'; ids: string[] } | null>` — null = ห้ามสแกนอัตโนมัติ (ไม่มีลิงก์ / ติดต่อไม่ได้ / ลิงก์ใช้ไม่ได้)
  - `deliver(payload: { products: readonly { productId: string }[] }, deps?): Promise<{ ok: true; count: number } | { ok: false; message: string }>`
  - `relativeDaysThai(iso: string, now: number): string` (ย้ายมาจาก app-link.ts เดิม)

- [ ] **Step 1: เขียนเทสที่ต้องล้ม**

`showcase-extension/tests/unit/destination.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PROTOCOL,
  checkDestination,
  deliver,
  getDeliveryMemory,
  parseDestinationLink,
  relativeDaysThai,
  resolveKnownIds,
  saveDestinationLink,
  type DestinationDeps,
} from '../../extension/src/dashboard/destination.js'

const LINK = 'http://localhost:3000/api/scanner?token=abc'

function makeDeps(fetchImpl: DestinationDeps['fetchImpl'], initial: Record<string, unknown> = { destinationLink: LINK }) {
  const store: Record<string, unknown> = { ...initial }
  const deps: DestinationDeps = {
    fetchImpl,
    storageGet: (keys) => Promise.resolve(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))),
    storageSet: (items) => {
      Object.assign(store, items)
      return Promise.resolve()
    },
    now: () => Date.parse('2026-09-29T05:00:00Z'),
  }
  return { deps, store }
}
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
const html = (status = 200) => Promise.resolve(new Response('<html>Script function not found: doGet</html>', { status }))

describe('parseDestinationLink', () => {
  it('ตัดช่องว่างหัวท้ายแล้วรับ localhost แบบ http', () => {
    expect(parseDestinationLink(`  ${LINK}  `)).toEqual({ ok: true, url: LINK })
  })
  it('รับ 127.0.0.1 แบบ http', () => {
    expect(parseDestinationLink('http://127.0.0.1:8080/hook?t=1').ok).toBe(true)
  })
  it('รับ https ทุกโฮสต์', () => {
    expect(parseDestinationLink('https://script.google.com/macros/s/X/exec?token=1').ok).toBe(true)
  })
  it('ปฏิเสธ http ไปเครื่องอื่น', () => {
    const r = parseDestinationLink('http://example.com/hook?token=1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('https')
  })
  it('ปฏิเสธข้อความที่ไม่ใช่ลิงก์ และลิงก์ว่าง', () => {
    expect(parseDestinationLink('ไม่ใช่ลิงก์').ok).toBe(false)
    expect(parseDestinationLink('   ').ok).toBe(false)
  })
})

describe('checkDestination — ไฟบน popup', () => {
  it('ยังไม่มีลิงก์ → no_link และไม่ยิง network', async () => {
    let called = false
    const { deps } = makeDeps(() => {
      called = true
      return json({})
    }, {})
    expect(await checkDestination(deps)).toEqual({ kind: 'no_link' })
    expect(called).toBe(false)
  })
  it('GET ตอบถูก protocol → ready', async () => {
    const { deps } = makeDeps(() => json({ protocol: PROTOCOL, productIds: ['1', '2'], lastReceivedAt: '2026-09-24T11:25:19.626Z' }))
    expect(await checkDestination(deps)).toEqual({ kind: 'ready', productCount: 2, lastReceivedAt: '2026-09-24T11:25:19.626Z' })
  })
  it('401/403 → rejected (ลิงก์ถูกสร้างใหม่แล้ว)', async () => {
    expect(await checkDestination(makeDeps(() => json({ error: 'unauthorized' }, 401)).deps)).toEqual({ kind: 'rejected' })
    expect(await checkDestination(makeDeps(() => json({}, 403)).deps)).toEqual({ kind: 'rejected' })
  })
  it('fetch โยน (เครื่องปิด/ลิงก์ผิดโดเมน) หรือ 5xx → unreachable', async () => {
    expect(await checkDestination(makeDeps(() => Promise.reject(new TypeError('Failed to fetch'))).deps)).toEqual({ kind: 'unreachable' })
    expect(await checkDestination(makeDeps(() => json({}, 502)).deps)).toEqual({ kind: 'unreachable' })
  })
  it('Apps Script ที่ไม่มี doGet (HTML 200) หรือ 405 → no_status พร้อมเวลาส่งล่าสุดจากความจำ', async () => {
    const at = '2026-09-27T01:00:00.000Z'
    const a = makeDeps(() => html(), { destinationLink: LINK, lastDeliveredAt: at })
    expect(await checkDestination(a.deps)).toEqual({ kind: 'no_status', lastDeliveredAt: at })
    const b = makeDeps(() => json({ error: 'method' }, 405))
    expect(await checkDestination(b.deps)).toEqual({ kind: 'no_status', lastDeliveredAt: null })
  })
})

describe('resolveKnownIds — รายการที่ใช้หยุดสแกนเอง', () => {
  it('ปลายทางตอบ GET → ใช้ของปลายทาง', async () => {
    const { deps } = makeDeps(() => json({ protocol: PROTOCOL, productIds: ['1'], lastReceivedAt: null }), {
      destinationLink: LINK,
      deliveredProductIds: ['9'],
    })
    expect(await resolveKnownIds(deps)).toEqual({ source: 'destination', ids: ['1'] })
  })
  it('ปลายทางไม่บอกสถานะ → ใช้ความจำ (ว่างได้ = ส่งครั้งแรกส่งทุกตัว)', async () => {
    expect(await resolveKnownIds(makeDeps(() => html()).deps)).toEqual({ source: 'memory', ids: [] })
  })
  it('ติดต่อไม่ได้ / ลิงก์ใช้ไม่ได้ / ไม่มีลิงก์ → null (ห้ามสแกนอัตโนมัติ)', async () => {
    expect(await resolveKnownIds(makeDeps(() => Promise.reject(new TypeError('x'))).deps)).toBeNull()
    expect(await resolveKnownIds(makeDeps(() => json({}, 401)).deps)).toBeNull()
    expect(await resolveKnownIds(makeDeps(() => json({}), {}).deps)).toBeNull()
  })
})

describe('deliver — POST ผลสแกน', () => {
  const payload = { protocol: PROTOCOL, products: [{ productId: '1' }, { productId: '2' }] }

  it('ส่งเป็น text/plain ไม่มี custom header และจำ ID ที่ส่งแล้ว', async () => {
    let init: RequestInit | undefined
    const { deps, store } = makeDeps((_url, i) => {
      init = i
      return json({ ok: true })
    }, { destinationLink: LINK, deliveredProductIds: ['0'] })
    expect(await deliver(payload, deps)).toEqual({ ok: true, count: 2 })
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('text/plain;charset=utf-8')
    expect([...new Headers(init?.headers).keys()]).toEqual(['content-type'])
    expect(JSON.parse(String(init?.body))).toEqual(payload)
    expect(store.deliveredProductIds).toEqual(['0', '1', '2'])
    expect(store.lastDeliveredAt).toBe('2026-09-29T05:00:00.000Z')
  })
  it('ตอบ 2xx แต่ไม่ใช่ JSON (Apps Script) ก็นับว่าสำเร็จ', async () => {
    const { deps } = makeDeps(() => Promise.resolve(new Response('OK', { status: 200 })))
    expect(await deliver(payload, deps)).toEqual({ ok: true, count: 2 })
  })
  it('401 → บอกว่าลิงก์ใช้ไม่ได้ และไม่จำอะไร', async () => {
    const { deps, store } = makeDeps(() => json({ error: 'unauthorized' }, 401))
    const r = await deliver(payload, deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('ลิงก์')
    expect(store.deliveredProductIds).toBeUndefined()
  })
  it('ไม่มีลิงก์ → ไม่ยิง', async () => {
    const r = await deliver(payload, makeDeps(() => json({}), {}).deps)
    expect(r.ok).toBe(false)
  })
  it('Apps Script ตอบ 401 ไม่ได้ — 200 + {"error":"unauthorized"} ต้องนับเป็นลิงก์ใช้ไม่ได้ ไม่จำอะไร', async () => {
    const { deps, store } = makeDeps(() => json({ error: 'unauthorized' }, 200))
    const r = await deliver(payload, deps)
    expect(r.ok).toBe(false)
    expect(store.deliveredProductIds).toBeUndefined()
    expect(await checkDestination(makeDeps(() => json({ error: 'unauthorized' }, 200)).deps)).toEqual({ kind: 'rejected' })
  })
})

describe('saveDestinationLink', () => {
  it('เปลี่ยนปลายทาง = ล้างความจำเดิม', async () => {
    const { deps, store } = makeDeps(() => json({}), { destinationLink: LINK, deliveredProductIds: ['1'], lastDeliveredAt: 'x' })
    await saveDestinationLink('https://example.com/h?token=2', deps)
    expect(store.destinationLink).toBe('https://example.com/h?token=2')
    expect(await getDeliveryMemory(deps)).toEqual({ ids: [], lastDeliveredAt: null })
  })
})

describe('relativeDaysThai', () => {
  const now = Date.parse('2026-09-29T05:00:00Z')
  it('วันนี้ / เมื่อวาน / N วันก่อน / อ่านไม่ได้', () => {
    expect(relativeDaysThai('2026-09-29T01:00:00Z', now)).toBe('วันนี้')
    expect(relativeDaysThai('2026-09-28T04:00:00Z', now)).toBe('เมื่อวาน')
    expect(relativeDaysThai('2026-09-24T04:00:00Z', now)).toBe('5 วันก่อน')
    expect(relativeDaysThai('x', now)).toBe('ไม่ทราบ')
  })
})
```

- [ ] **Step 2: รันเทส ต้องล้ม**

Run: `cd showcase-extension && npx vitest run tests/unit/destination.test.ts`
Expected: FAIL — `Failed to resolve import "../../extension/src/dashboard/destination.js"`

- [ ] **Step 3: เขียน `destination.ts`**

```ts
/**
 * Protocol client ของ "ลิงก์ปลายทาง" (Destination link — CONTEXT.md) — ไฟล์เดียวที่รู้จัก protocol
 * `showcase-scanner/1` ใช้ร่วมกันโดย popup (ไฟสถานะ) และหน้าจัดการ (หยุดเอง + ส่งผล)
 * สเปก: docs/superpowers/specs/2026-09-29-showcase-destination-link-design.md · เหตุผลที่ฝังรหัส
 * ในลิงก์: docs/adr/0001-destination-link-secret-in-url.md (ใน repo ของ Angle)
 *
 * POST เป็น simple request (text/plain ไม่มี custom header) จึงไม่มี preflight — ใช้กับ Google
 * Apps Script ได้ · ไม่ต้องมี host permission ของปลายทาง แค่ปลายทางตอบ CORS (ยืนยันสด 2026-09-29)
 */
export const PROTOCOL = 'showcase-scanner/1'

const KEY_LINK = 'destinationLink'
const KEY_DELIVERED = 'deliveredProductIds'
const KEY_LAST = 'lastDeliveredAt'
const TIMEOUT_MS = 5000

export interface DestinationDeps {
  readonly fetchImpl: typeof fetch
  storageGet(keys: string[]): Promise<Record<string, unknown>>
  storageSet(items: Record<string, unknown>): Promise<void>
  now(): number
}

export const defaultDestinationDeps = (): DestinationDeps => ({
  fetchImpl: (...args) => fetch(...args),
  storageGet: (keys) => chrome.storage.local.get(keys) as Promise<Record<string, unknown>>,
  storageSet: (items) => chrome.storage.local.set(items),
  now: () => Date.now(),
})

export function parseDestinationLink(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, message: 'ยังไม่ได้วางลิงก์' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, message: 'ข้อความนี้ไม่ใช่ลิงก์ — คัดลอกลิงก์ปลายทางมาทั้งบรรทัด' }
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return { ok: true, url: trimmed }
  return { ok: false, message: 'ลิงก์ต้องขึ้นต้นด้วย https:// (ยกเว้นระบบในเครื่องตัวเอง localhost)' }
}

export async function getDestinationLink(deps: DestinationDeps = defaultDestinationDeps()): Promise<string> {
  const v = (await deps.storageGet([KEY_LINK]))[KEY_LINK]
  return typeof v === 'string' ? v : ''
}

export async function saveDestinationLink(url: string, deps: DestinationDeps = defaultDestinationDeps()): Promise<void> {
  // เปลี่ยนปลายทาง = สิ่งที่เคยส่งไปที่เดิมไม่เกี่ยวกับที่ใหม่
  await deps.storageSet({ [KEY_LINK]: url, [KEY_DELIVERED]: [], [KEY_LAST]: null })
}

export async function getDeliveryMemory(
  deps: DestinationDeps = defaultDestinationDeps(),
): Promise<{ ids: string[]; lastDeliveredAt: string | null }> {
  const s = await deps.storageGet([KEY_DELIVERED, KEY_LAST])
  const ids = Array.isArray(s[KEY_DELIVERED]) ? s[KEY_DELIVERED].filter((x): x is string => typeof x === 'string') : []
  return { ids, lastDeliveredAt: typeof s[KEY_LAST] === 'string' ? s[KEY_LAST] : null }
}

export async function clearDeliveryMemory(deps: DestinationDeps = defaultDestinationDeps()): Promise<void> {
  await deps.storageSet({ [KEY_DELIVERED]: [], [KEY_LAST]: null })
}

export type DestinationStatus =
  | { readonly kind: 'no_link' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'ready'; readonly productCount: number; readonly lastReceivedAt: string | null }
  | { readonly kind: 'no_status'; readonly lastDeliveredAt: string | null }

type Probe =
  | { kind: 'no_link' | 'unreachable' | 'rejected' | 'no_status' }
  | { kind: 'ready'; productIds: string[]; lastReceivedAt: string | null }

/** GET ลิงก์ปลายทางหนึ่งครั้ง — ไม่ throw เด็ดขาด */
async function probe(deps: DestinationDeps): Promise<Probe> {
  const link = await getDestinationLink(deps)
  if (link === '') return { kind: 'no_link' }
  let res: Response
  try {
    res = await deps.fetchImpl(link, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    return { kind: 'unreachable' }
  }
  if (res.status === 401 || res.status === 403) return { kind: 'rejected' }
  if (res.status >= 500) return { kind: 'unreachable' }
  if (!res.ok) return { kind: 'no_status' }
  try {
    const body = (await res.json()) as { protocol?: unknown; productIds?: unknown; lastReceivedAt?: unknown; error?: unknown }
    if (body.error === 'unauthorized') return { kind: 'rejected' } // Apps Script ตอบ 401 ไม่ได้ ใช้ body แทน
    if (body.protocol !== PROTOCOL || !Array.isArray(body.productIds)) return { kind: 'no_status' }
    return {
      kind: 'ready',
      productIds: body.productIds.filter((x): x is string => typeof x === 'string'),
      lastReceivedAt: typeof body.lastReceivedAt === 'string' ? body.lastReceivedAt : null,
    }
  } catch {
    return { kind: 'no_status' } // เช่น Apps Script ที่ไม่มี doGet ตอบเป็น HTML
  }
}

export async function checkDestination(deps: DestinationDeps = defaultDestinationDeps()): Promise<DestinationStatus> {
  const p = await probe(deps)
  if (p.kind === 'ready') return { kind: 'ready', productCount: p.productIds.length, lastReceivedAt: p.lastReceivedAt }
  if (p.kind === 'no_status') return { kind: 'no_status', lastDeliveredAt: (await getDeliveryMemory(deps)).lastDeliveredAt }
  return { kind: p.kind }
}

/**
 * รายการสินค้าที่ถือว่า "ส่งแล้ว" สำหรับหยุดสแกนเอง — ปลายทางบอกได้ใช้ของปลายทาง (แม่นกว่า) ไม่งั้นใช้
 * ความจำ · null = ห้ามสแกนอัตโนมัติ: ถ้าติดต่อไม่ได้แล้วยังสแกนต่อด้วยความจำ อาจส่งไม่ได้ทั้งรอบ
 */
export async function resolveKnownIds(
  deps: DestinationDeps = defaultDestinationDeps(),
): Promise<{ source: 'destination' | 'memory'; ids: string[] } | null> {
  const p = await probe(deps)
  if (p.kind === 'ready') return { source: 'destination', ids: p.productIds }
  if (p.kind === 'no_status') return { source: 'memory', ids: (await getDeliveryMemory(deps)).ids }
  return null
}

/**
 * POST ผลสแกน · 2xx = สำเร็จ (ไม่อ่าน body — ปลายทางตอบอะไรก็ได้) แล้วจำ "ทุก ID ที่ส่ง" ไม่ใช่เฉพาะที่
 * ปลายทางเก็บ — สินค้าที่ปลายทางข้าม (เช่นหมดสต็อก) ต้องไม่ถูกนับเป็น "ใหม่" ซ้ำทุกรอบ (ดูสเปกข้อ 5)
 */
export async function deliver(
  payload: { readonly products: readonly { readonly productId: string }[] },
  deps: DestinationDeps = defaultDestinationDeps(),
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const link = await getDestinationLink(deps)
  if (link === '') return { ok: false, message: 'ยังไม่ได้ใส่ลิงก์ปลายทาง — ใส่ที่ส่วน "ตั้งค่า"' }
  let res: Response
  try {
    res = await deps.fetchImpl(link, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return { ok: false, message: 'ติดต่อปลายทางไม่ได้ — เช็กว่าระบบปลายทางเปิดอยู่' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'ลิงก์ปลายทางใช้ไม่ได้แล้ว (อาจถูกสร้างใหม่) — คัดลอกลิงก์ล่าสุดมาใส่ใหม่' }
  }
  if (!res.ok) return { ok: false, message: `ปลายทางตอบกลับว่าไม่สำเร็จ (${String(res.status)})` }
  // Apps Script ตอบสถานะ 401 ไม่ได้ (200 เสมอ) — protocol ให้ตอบ {"error":"unauthorized"} แทน ต้องไม่นับว่าส่งสำเร็จ
  const text = await res.text().catch(() => '')
  if (/"error"\s*:\s*"unauthorized"/.test(text)) {
    return { ok: false, message: 'ลิงก์ปลายทางใช้ไม่ได้แล้ว (อาจถูกสร้างใหม่) — คัดลอกลิงก์ล่าสุดมาใส่ใหม่' }
  }

  const memory = await getDeliveryMemory(deps)
  const ids = new Set(memory.ids)
  for (const p of payload.products) ids.add(p.productId)
  await deps.storageSet({ [KEY_DELIVERED]: [...ids], [KEY_LAST]: new Date(deps.now()).toISOString() })
  return { ok: true, count: payload.products.length }
}

/** "3 วันก่อน" / "วันนี้" สำหรับบรรทัดเวลาบน popup */
export function relativeDaysThai(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'ไม่ทราบ'
  const days = Math.floor((now - then) / 86_400_000)
  if (days <= 0) return 'วันนี้'
  if (days === 1) return 'เมื่อวาน'
  return `${String(days)} วันก่อน`
}
```

- [ ] **Step 4: รันเทส ต้องผ่าน**

Run: `cd showcase-extension && npx vitest run tests/unit/destination.test.ts && npx tsc --noEmit`
Expected: PASS ทุกเคส, typecheck ผ่าน

- [ ] **Step 5: Commit**

```bash
git add showcase-extension/extension/src/dashboard/destination.ts showcase-extension/tests/unit/destination.test.ts
git commit -m "Showcase Scanner: destination-link protocol client (showcase-scanner/1)"
```

---

### Task 2: Extension — payload บอก protocol + runner นับสินค้าตายเป็นรู้จักแล้ว

**Files:**
- Modify: `showcase-extension/extension/src/export/json.ts` (interface `ExportPayload` + `buildExport`)
- Modify: `showcase-extension/extension/src/core/runner.ts:492`
- Test: `showcase-extension/tests/unit/export.test.ts`, `showcase-extension/tests/unit/runner.test.ts`

**Interfaces:**
- Consumes: `PROTOCOL` จาก Task 1
- Produces: `ExportPayload.protocol: 'showcase-scanner/1'` (ทั้ง full scan และ probe export)

- [ ] **Step 1: เทสที่ต้องล้ม** — ใน `tests/unit/export.test.ts` หา test ที่ตรวจ key set ของ payload (ค้นคำว่า `resultKind` / `Object.keys`) เพิ่ม `'protocol'` ลงใน key set ที่คาดหวัง และเพิ่ม:

```ts
it('payload บอก protocol ของลิงก์ปลายทาง', () => {
  const payload = buildExport(report, [], () => 0)
  expect(payload.protocol).toBe('showcase-scanner/1')
})
```

ใน `tests/unit/runner.test.ts` เพิ่ม (ใช้ helper สร้าง page/transport แบบเดียวกับเทส `known_ids_reached` ที่มีอยู่ — ค้น `known_ids_reached` ในไฟล์แล้วก๊อปโครงเทสนั้นมา เปลี่ยนแค่หน้าแรกให้มีสินค้าหนึ่งตัวที่ `status_popup` เป็น object และ ID ไม่อยู่ใน knownProductIds):

```ts
it('หน้าที่มีสินค้าตาย (hasStatusPopup) ปนกับสินค้าที่รู้จักแล้ว ยังนับเป็นหน้าที่รู้จักแล้ว → หยุด', async () => {
  // หน้า 1: '111' (รู้จักแล้ว) + '222' (status_popup = สินค้าตาย ไม่เคยถูกเก็บที่ปลายทาง)
  // knownProductIds: ['111']  → stopReason ต้องเป็น 'known_ids_reached' ที่หน้า 1
})
```

- [ ] **Step 2: รัน ต้องล้ม**

Run: `cd showcase-extension && npx vitest run tests/unit/export.test.ts tests/unit/runner.test.ts`
Expected: FAIL — `protocol` undefined และ runner ไม่หยุดที่หน้า 1

- [ ] **Step 3: แก้โค้ด**

`export/json.ts` — เพิ่มใน interface (ต่อจาก `resultKind`):

```ts
  /** ลิงก์ปลายทางใช้แยกรุ่นของรูปแบบข้อมูล — ดู dashboard/destination.ts และ docs/INTEGRATION.md */
  readonly protocol: typeof PROTOCOL
```

พร้อม `import { PROTOCOL } from '../dashboard/destination.js'` และใส่ `protocol: PROTOCOL,` ใน object ที่ `buildExport` และ `buildProbeExport` คืน

`core/runner.ts:492` เปลี่ยนเงื่อนไขเป็น:

```ts
      // สินค้าที่ TikTok บอกว่าตายแล้ว (status_popup) ปลายทางไม่เก็บ จึงไม่มีวันอยู่ในรายการ "รู้จักแล้ว" —
      // ถ้าไม่นับเป็นรู้จักแล้ว หน้าที่มีสินค้าตายปนจะไม่มีวันทำให้หยุด (สเปก 2026-09-29 ข้อ 5)
      if (
        knownIdSet !== null &&
        page.products.length > 0 &&
        page.products.every((p) => p.hasStatusPopup || knownIdSet.has(p.productId))
      ) {
```

- [ ] **Step 4: รันเทสทั้งชุด ต้องผ่าน**

Run: `cd showcase-extension && npx vitest run && npx tsc --noEmit`
Expected: ผ่านทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add showcase-extension/extension/src/export/json.ts showcase-extension/extension/src/core/runner.ts showcase-extension/tests/unit/export.test.ts showcase-extension/tests/unit/runner.test.ts
git commit -m "Showcase Scanner: payload carries protocol; dead products count as known when auto-stopping"
```

---

### Task 3: Extension — ขอสิทธิ์ TikTok ตอนติดตั้ง, ตัดสิทธิ์ localhost, ชื่อ extension

**Files:**
- Modify: `showcase-extension/extension/manifest.json`
- Modify: `showcase-extension/extension/src/domain/permissions.ts` (ลบ `APP_HOST_PERMISSION_ORIGIN`)
- Modify: `showcase-extension/tests/unit/pk01-manifest.test.ts`
- Modify: `showcase-extension/README.md` (ตารางสิทธิ์ ~บรรทัด 160)

**Interfaces:** Produces: `SHOWCASE_HOST_PERMISSION_ORIGIN` ตรงกับ `host_permissions[0]`

- [ ] **Step 1: แก้เทส PK01 ก่อน (ต้องล้ม)** — แทน 2 เทสเรื่อง host permission ด้วย:

```ts
  it('host permission บังคับมีแค่ shop.tiktok.com (ขอตอนติดตั้ง) และไม่มี optional host เลย — ปลายทางใช้ CORS ไม่ใช้สิทธิ์', () => {
    expect(manifest.host_permissions).toEqual(['https://shop.tiktok.com/*'])
    expect(manifest.optional_host_permissions).toBeUndefined()
  })

  it('domain/permissions.ts ตรงกับ manifest เป๊ะ — กัน drift', () => {
    expect(manifest.host_permissions).toEqual([SHOWCASE_HOST_PERMISSION_ORIGIN])
  })
```

และแก้ import ให้เหลือ `SHOWCASE_HOST_PERMISSION_ORIGIN` · เทส "ไม่มี wildcard host กว้าง" คงไว้ตามเดิม

Run: `cd showcase-extension && npx vitest run tests/unit/pk01-manifest.test.ts` → Expected: FAIL

- [ ] **Step 2: แก้ manifest**

```json
  "name": "Showcase Scanner",
  "version": "0.2.0",
  "description": "อ่านรายการสินค้าใน Showcase ของบัญชี TikTok ของคุณเอง แล้วส่งไปยังระบบของคุณผ่านลิงก์ปลายทาง หรือ export เป็น JSON",
  "permissions": ["storage"],
  "host_permissions": ["https://shop.tiktok.com/*"],
```

(ลบบรรทัด `optional_host_permissions`) และ `"default_title": "Showcase Scanner"` · ก่อนแก้ `name`/`default_title` ให้รัน `grep -rn "LIVE TRIAL\|(mock)" showcase-extension/tests showcase-extension/scripts` — ถ้ามีเทส/สคริปต์อ้างชื่อเดิม ให้แก้ตาม (build.mjs อาจแทน default_title ตาม mode — ถ้ามี ให้คงพฤติกรรม mock build ไว้)

- [ ] **Step 3: `permissions.ts`** — ลบ `APP_HOST_PERMISSION_ORIGIN` ทั้งก้อน และแก้คอมเมนต์หัวไฟล์เป็น "ต้องตรงกับ `host_permissions` ใน manifest.json เป๊ะ" · รัน `grep -rn APP_HOST_PERMISSION_ORIGIN showcase-extension/extension showcase-extension/tests` — จุดที่เหลือ (dashboard/main.ts, app-link.ts) จะถูกแก้ใน Task 4/5; ถ้า typecheck ล้มเพราะจุดพวกนั้น ให้ทำ Task 3 กับ Task 4 ต่อเนื่องกันก่อน commit

- [ ] **Step 4: README** — แถว `optional_host_permissions` ในตารางสิทธิ์ เปลี่ยนเป็น `host_permissions: https://shop.tiktok.com/*` | "ขอตอนติดตั้ง เพราะเป็นหน้าที่หลัก — ปลายทางไม่ต้องใช้สิทธิ์ (ใช้ CORS) ดู docs/INTEGRATION.md"

- [ ] **Step 5: รัน + commit** (หลัง Task 4 ถ้า typecheck ยังพึ่งของเก่า)

Run: `cd showcase-extension && npx vitest run && npx tsc --noEmit`

```bash
git add showcase-extension/extension/manifest.json showcase-extension/extension/src/domain/permissions.ts showcase-extension/tests/unit/pk01-manifest.test.ts showcase-extension/README.md
git commit -m "Showcase Scanner: TikTok host permission at install, drop localhost permission, plain name"
```

---

### Task 4: Extension — หน้าจัดการเหลือแค่ของที่ใช้จริง + ต่อ destination.ts

**Files:**
- Rewrite: `showcase-extension/extension/src/dashboard/index.html`
- Modify: `showcase-extension/extension/src/dashboard/main.ts`
- Modify: `showcase-extension/extension/src/dashboard/dashboard.css`
- Test: `showcase-extension/tests/e2e/load-unpacked.spec.ts`, e2e อื่นที่อ้าง id ที่ถูกลบ

**Interfaces:**
- Consumes (Task 1): `parseDestinationLink`, `getDestinationLink`, `saveDestinationLink`, `clearDeliveryMemory`, `resolveKnownIds`, `deliver`; (เดิมใน app-link.ts) `consumeAutoScanRequest` — **ย้าย `requestAutoScan`/`consumeAutoScanRequest` จาก app-link.ts มาไว้ท้าย destination.ts ทั้งสองฟังก์ชันพร้อมคอมเมนต์เดิม** (popup Task 5 ใช้ `requestAutoScan`)

- [ ] **Step 1: E2E ที่ต้องล้ม** — ใน `tests/e2e/load-unpacked.spec.ts` เพิ่ม:

```ts
test('หน้าจัดการ: ไม่มีส่วนขอสิทธิ์/secret แล้ว และส่วนตั้งค่ากางเองเมื่อยังไม่มีลิงก์', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)
  await expect(page.locator('#grant-permission-button')).toHaveCount(0)
  await expect(page.locator('#app-secret-input')).toHaveCount(0)
  await expect(page.locator('#settings')).toHaveAttribute('open', '')
  await page.locator('#destination-input').fill('http://example.com/hook')
  await page.locator('#save-destination-button').click()
  await expect(page.locator('#destination-status')).toContainText('https://')
  await page.locator('#destination-input').fill('http://localhost:3000/api/scanner?token=t')
  await page.locator('#save-destination-button').click()
  await expect(page.locator('#destination-status')).toContainText('บันทึกลิงก์แล้ว')
  await page.reload()
  await expect(page.locator('#settings')).not.toHaveAttribute('open', '')
})
```

และแก้เทส auto-scan เดิมให้คาดข้อความใหม่: ไม่มีลิงก์ → `#auto-status` มีคำว่า `ยังไม่ได้ใส่ลิงก์ปลายทาง`

Run: `cd showcase-extension && npm run test:e2e` → Expected: FAIL

- [ ] **Step 2: เขียน `index.html` ใหม่** (id ของส่วนสแกน/preview คงเดิมทั้งหมด เพื่อไม่ให้ E2E เดิมพัง):

```html
<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Showcase Scanner</title>
    <link rel="stylesheet" href="dashboard.css" />
  </head>
  <body>
    <main>
      <p id="channel-banner" class="banner" role="status">
        MOCK-ONLY PROTOTYPE — ยังไม่เชื่อมต่อบริการภายนอกจริง (G0 ยังไม่ผ่าน)
      </p>

      <h1>Showcase Scanner</h1>
      <p id="auto-status" class="notice" role="status" aria-live="polite" hidden></p>

      <section aria-labelledby="run-heading">
        <h2 id="run-heading">สแกน Showcase</h2>
        <div id="run-status" class="rows" role="status" aria-live="polite">กำลังตรวจสถานะ…</div>
        <button id="start-button" type="button">เริ่มสแกน</button>
        <button id="cancel-button" type="button" hidden>ยกเลิก</button>
      </section>

      <section id="preview-section" aria-labelledby="preview-heading" hidden>
        <!-- เนื้อในส่วน preview เหมือนเดิมทุกบรรทัด (tabs, selection-controls, product-list,
             rejected-list, pagination) ยกเว้นปุ่มท้าย: -->
        <button id="push-button" type="button">ส่งไปปลายทาง</button>
        <button id="export-button" type="button">Export JSON</button>
        <div id="push-result" class="rows" role="status" aria-live="polite"></div>
      </section>

      <details id="settings">
        <summary>ตั้งค่า</summary>

        <h2>ลิงก์ปลายทาง</h2>
        <p class="hint">ลิงก์จากระบบที่จะรับผลสแกน (เช่น ปุ่ม "คัดลอกลิงก์" ในแอปของคุณ) — ใส่ครั้งเดียว</p>
        <div class="row-buttons">
          <input id="destination-input" type="text" autocomplete="off" placeholder="https://…" />
          <button id="save-destination-button" type="button">บันทึกลิงก์</button>
        </div>
        <div id="destination-status" class="hint" role="status" aria-live="polite"></div>

        <label>
          <input id="auto-stop-known-checkbox" type="checkbox" checked />
          หยุดสแกนเองเมื่อเจอหน้าที่มีแต่สินค้าที่ส่งไปแล้ว (แนะนำ)
        </label>
        <label for="max-pages-input">จำกัดจำนวนหน้า (เว้นว่าง = ไม่จำกัด)</label>
        <input id="max-pages-input" type="number" min="1" step="1" placeholder="ทั้งหมด" />
        <div class="row-buttons">
          <button id="max-pages-1" type="button">1 หน้า</button>
          <button id="max-pages-2" type="button">2 หน้า</button>
          <button id="max-pages-all" type="button">ทั้งหมด</button>
        </div>

        <button id="clear-memory-button" type="button">ลืมรายการที่เคยส่งแล้ว</button>
        <button id="clear-data-button" type="button">ล้างข้อมูลที่เก็บไว้</button>

        <h2 id="probe-heading">เครื่องมือทดสอบ: อ่านทีละหน้า</h2>
        <button id="probe-button" type="button">อ่านหน้าแรก (offset=0)</button>
        <button id="probe-next-button" type="button" hidden>อ่านหน้าถัดไป</button>
        <button id="probe-export-button" type="button" hidden>Export ผลทดสอบหน้านี้</button>
        <div id="probe-result" class="rows" role="status" aria-live="polite"></div>

        <h2 id="build-heading">ข้อมูล build</h2>
        <div id="build-info" class="rows">กำลังโหลด…</div>
      </details>
    </main>
    <script type="module" src="main.js"></script>
  </body>
</html>
```

(ก๊อปเนื้อในของ `preview-section` เดิมมาวางแทนคอมเมนต์ในตัวอย่าง — ไม่แก้ id ใดๆ ในนั้น)

- [ ] **Step 3: `main.ts`**
  1. import: แทน `from './app-link.js'` ด้วย `import { clearDeliveryMemory, consumeAutoScanRequest, deliver, getDestinationLink, parseDestinationLink, resolveKnownIds, saveDestinationLink } from './destination.js'` · ลบ import `APP_HOST_PERMISSION_ORIGIN`
  2. ลบทั้งหมด: ส่วน "สิทธิ์เข้าถึง shop.tiktok.com" (`permissionStatusEl`, `grantPermissionButton`, `refreshPermissionStatus` + listener), ส่วนสิทธิ์แอปหลัก (`appPermissionStatusEl` … `refreshAppPermissionStatus`), ส่วน secret (`appSecretInput` … `refreshAppSecretStatus`) และการเรียกฟังก์ชันเหล่านี้ท้ายไฟล์
  3. แทน `resolveKnownProductIds` ด้วย:

```ts
/** รายการ "ส่งแล้ว" สำหรับหยุดเอง — ปิดตัวเลือกไว้ = null (สแกนเต็ม) · ดู destination.ts resolveKnownIds */
async function resolveKnownProductIds(): Promise<readonly string[] | null> {
  const checkbox = requireElement('auto-stop-known-checkbox') as HTMLInputElement
  if (!checkbox.checked) return null
  return (await resolveKnownIds())?.ids ?? null
}
```

  4. แทน `pushSelectedToApp` ด้วย:

```ts
async function pushSelectedToDestination(): Promise<{ ok: boolean; message: string }> {
  const result = await send({ type: 'run.export', selectedIds: [...state.selected] })
  if (!result.ok) return { ok: false, message: `เตรียมข้อมูลไม่สำเร็จ: ${result.code}` }
  const sent = await deliver(result.payload)
  return sent.ok ? { ok: true, message: `✅ ส่งไปปลายทางแล้ว ${String(sent.count)} รายการ` } : sent
}
```

  และให้ปุ่ม `push-button` เรียก `pushSelectedToDestination`
  5. ใน `runAutoScanAndPush`: ก่อนสแกน

```ts
  if ((await getDestinationLink()) === '') {
    setAutoStatus('ยังไม่ได้ใส่ลิงก์ปลายทาง — ใส่ที่ส่วน "ตั้งค่า" ก่อน ยังไม่ได้สแกนอะไร', 'warning')
    settingsEl.open = true
    return
  }
  const known = await resolveKnownIds()
  if (known === null) {
    setAutoStatus('ติดต่อปลายทางไม่ได้ หรือลิงก์ใช้ไม่ได้แล้ว — ยังไม่ได้สแกนอะไร', 'warning')
    return
  }
  const knownProductIds = known.ids
```

  (แทนบล็อกเดิมที่เรียก `resolveKnownProductIds()` และข้อความ "ถามรายการสินค้าจาก Angle ไม่ได้") และเปลี่ยนการส่งท้ายฟังก์ชันเป็น `pushSelectedToDestination()` · ข้อความสำเร็จ: `${pushed.message}` (ไม่อ้างถึง Angle — extension ไม่รู้จัก Angle แล้ว)
  6. ส่วนตั้งค่า:

```ts
const settingsEl = requireElement('settings') as HTMLDetailsElement
const destinationInput = requireElement('destination-input') as HTMLInputElement
const destinationStatusEl = requireElement('destination-status')

async function refreshDestination(): Promise<void> {
  const link = await getDestinationLink()
  // ยังไม่มีลิงก์ = ใช้ส่ง/หยุดเองไม่ได้ กางส่วนตั้งค่าให้เห็นทันที
  settingsEl.open = link === ''
  setText(destinationStatusEl, link === '' ? 'ยังไม่ได้ใส่ลิงก์ปลายทาง' : '✅ มีลิงก์ปลายทางแล้ว')
}

requireElement('save-destination-button').addEventListener('click', () => {
  void (async () => {
    const parsed = parseDestinationLink(destinationInput.value)
    if (!parsed.ok) {
      setText(destinationStatusEl, parsed.message)
      return
    }
    await saveDestinationLink(parsed.url)
    destinationInput.value = ''
    setText(destinationStatusEl, '✅ บันทึกลิงก์แล้ว')
  })()
})

requireElement('clear-memory-button').addEventListener('click', () => {
  void clearDeliveryMemory().then(() => setText(destinationStatusEl, 'ลืมรายการที่เคยส่งแล้ว — รอบหน้าจะส่งทุกตัวที่สแกนเจอ'))
})
```

  และเรียก `void refreshDestination()` ท้ายไฟล์ (แทน 3 refresh เดิม)

- [ ] **Step 4: CSS** — เพิ่มใน `dashboard.css`:

```css
#settings {
  margin: 32px 0 0;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}

#settings > summary {
  cursor: pointer;
  font-weight: 600;
}
```

- [ ] **Step 5: รันทุกชุด**

Run: `cd showcase-extension && npx tsc --noEmit && npx vitest run && npm run test:e2e`
Expected: ผ่านทั้งหมด (ถ้า e2e เดิมตัวไหนอ้าง `#grant-permission-button`/`#permission-status` ในเทส probe-and-permission ให้แก้เทสนั้นเป็นการตรวจว่าไม่มีส่วนนั้นแล้ว — เพราะสิทธิ์ได้ตอนติดตั้ง)

- [ ] **Step 6: Commit**

```bash
git add showcase-extension/extension/src/dashboard showcase-extension/tests
git commit -m "Showcase Scanner: dashboard sends to the destination link; setup folded into a settings section"
```

---

### Task 5: Extension — popup ไฟสถานะปลายทาง + เลขเวอร์ชัน

**Files:**
- Rewrite: `showcase-extension/extension/src/popup/main.ts`
- Modify: `showcase-extension/extension/src/popup/index.html` (เพิ่ม `<p id="version" class="version"></p>` ท้าย body ก่อน script)
- Modify: `showcase-extension/extension/src/popup/popup.css` (`.version { margin: 12px 0 0; font-size: 0.75rem; color: var(--muted-foreground); text-align: center; }`)
- Delete: `showcase-extension/extension/src/dashboard/app-link.ts`, `showcase-extension/tests/unit/app-link.test.ts`
- Test: `showcase-extension/tests/e2e/load-unpacked.spec.ts`

**Interfaces:** Consumes (Task 1/4): `checkDestination`, `relativeDaysThai`, `requestAutoScan`, `DestinationStatus`

- [ ] **Step 1: E2E ที่ต้องล้ม** — แก้เทส popup เดิม: ส่วนที่คาด `ยังไม่ได้อนุญาตให้เชื่อมต่อ Angle` เปลี่ยนเป็น

```ts
  await expect(page.locator('#app-title')).toContainText('ยังไม่ได้ใส่ลิงก์ปลายทาง')
  await expect(page.locator('#scan-push')).toBeDisabled()
  await expect(page.locator('#version')).toContainText('0.2.0')
```

Run: `npm run test:e2e` → Expected: FAIL

- [ ] **Step 2: `renderConnection` ใหม่ใน popup/main.ts** (ส่วนอื่นของไฟล์คงเดิม — import เปลี่ยนเป็น `from '../dashboard/destination.js'`, ปุ่มใหม่ label `สแกนสินค้าใหม่ → ส่งไปปลายทาง`):

```ts
function renderConnection(status: DestinationStatus): void {
  const now = Date.now()
  const [tone, title, detail, canScan] = ((): ['ok' | 'bad' | 'idle', string, string, boolean] => {
    switch (status.kind) {
      case 'ready':
        return ['ok', 'เชื่อมต่อปลายทางแล้ว',
          `${String(status.productCount)} สินค้าที่ปลายทาง` +
            (status.lastReceivedAt === null ? '' : ` · รับล่าสุด ${relativeDaysThai(status.lastReceivedAt, now)}`),
          true]
      case 'no_status':
        return ['idle', 'ปลายทางไม่ได้บอกสถานะ — ส่งได้ตามปกติ',
          status.lastDeliveredAt === null ? 'ยังไม่เคยส่ง' : `ส่งสำเร็จล่าสุด ${relativeDaysThai(status.lastDeliveredAt, now)}`,
          true]
      case 'unreachable':
        return ['bad', 'ติดต่อปลายทางไม่ได้', 'เปิดระบบปลายทาง (เช่น start.bat) แล้วกดไอคอนนี้ใหม่', false]
      case 'rejected':
        return ['bad', 'ลิงก์ปลายทางใช้ไม่ได้แล้ว', 'อาจถูกสร้างลิงก์ใหม่ — คัดลอกลิงก์ล่าสุดมาใส่ในหน้าจัดการ', false]
      case 'no_link':
        return ['idle', 'ยังไม่ได้ใส่ลิงก์ปลายทาง', 'เปิดหน้าจัดการ → ตั้งค่า → วางลิงก์ (ทำครั้งเดียว)', false]
    }
  })()
  appDot.className = `status-dot status-dot-${tone === 'ok' ? 'finished' : tone === 'bad' ? 'bad' : 'idle'}`
  setText(appTitle, title)
  setText(appDetail, detail)
  appReady = canScan
  refreshScanButton()
}
```

ท้ายไฟล์: `void checkDestination().then(renderConnection)` และ `setText(requireElement('version'), `เวอร์ชัน ${chrome.runtime.getManifest().version}`)` · แก้คอมเมนต์หัวส่วนให้พูดถึง "ปลายทาง" ไม่ใช่ Angle

- [ ] **Step 3: ลบ app-link.ts + เทสของมัน** แล้ว `grep -rn "app-link" showcase-extension/extension showcase-extension/tests` ต้องว่าง

- [ ] **Step 4: รันทุกชุด**

Run: `cd showcase-extension && npx tsc --noEmit && npx vitest run && npm run test:e2e && npm run build`
Expected: ผ่านทั้งหมด (รวม PK02/PK03 ใน `tests/integration`)

- [ ] **Step 5: Commit**

```bash
git add -A showcase-extension/extension showcase-extension/tests
git commit -m "Showcase Scanner: popup light reflects the destination link (green/gray/red) + version"
```

---

### Task 6: Angle — ลิงก์ปลายทาง `/api/scanner` (token ใน DB) แทน 3 route เดิม

**Files:**
- Modify: `prisma/schema.prisma` · Create: `prisma/migrations/20260929120000_add_scanner_link/migration.sql`
- Create: `lib/scanner-link.ts`, `scripts/check-scanner-link.mjs`
- Create: `app/api/scanner/route.ts`
- Delete: `app/api/showcase-import/route.ts`, `app/api/showcase-import/known-ids/route.ts`, `app/api/showcase-import/health/route.ts`
- Modify: `lib/cors.ts`

**Interfaces:**
- Produces:
  - Prisma model `ScannerLink { id String @id @default("singleton"); token String; createdAt DateTime @default(now()) }`
  - `lib/scanner-link.ts`: `SCANNER_PROTOCOL = "showcase-scanner/1"`, `newToken(): string` (32 bytes hex), `tokensMatch(given: string | null, expected: string): boolean` (timing-safe)
  - `app/actions.ts` (Task 7 ใช้): `getScannerToken(): Promise<string>` (สร้างครั้งแรกถ้ายังไม่มี), `regenerateScannerToken(): Promise<string>`
  - Route: `GET /api/scanner?token=` → `{ protocol, productIds, lastReceivedAt }` · `POST /api/scanner?token=` body text → `importShowcaseBatch` → `{ ok: true, added, skipped, imagesFailed }` · 401 `{ error: "unauthorized" }` · OPTIONS 204 · CORS ทุก response

- [ ] **Step 1: schema + migration (ยังไม่แตะ dev.db จริง)**

`prisma/schema.prisma` ต่อท้าย:

```prisma
/// token ของ "ลิงก์ปลายทาง" ที่ Showcase Scanner ใช้ส่งผลสแกนเข้า Angle (แถวเดียว id = "singleton")
/// เก็บใน DB ไม่ใช่ .env เพื่อให้กด "สร้างลิงก์ใหม่" ในแอปได้ — ดู docs/adr/0001-destination-link-secret-in-url.md
model ScannerLink {
  id        String   @id @default("singleton")
  token     String
  createdAt DateTime @default(now())
}
```

`prisma/migrations/20260929120000_add_scanner_link/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "ScannerLink" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Run (บนสำเนาเท่านั้น):
```bash
cp dev.db dev-test.db && cp dev.db-wal dev-test.db-wal 2>/dev/null; node scripts/enable-wal.mjs dev-test.db
DATABASE_URL="file:./dev-test.db" npx prisma migrate deploy
npx prisma generate
```
Expected: `1 migration applied` (ถ้าไม่ใช่ ให้หยุดและรายงาน — ห้ามรัน `migrate dev`/`migrate reset`)

- [ ] **Step 2: เทสที่ต้องล้ม** `scripts/check-scanner-link.mjs` (แบบเดียวกับ `scripts/check-candidates.mjs` — compile `lib/scanner-link.ts` ไป temp dir แล้ว import):

```js
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-scanner-link-tmp-"));
let failed = 0;
const check = (name, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`}`);
};
try {
  execFileSync("npx", ["tsc", "lib/scanner-link.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler", "--types", "node"], { stdio: "inherit", shell: true });
  const s = await import(pathToFileURL(join(out, "scanner-link.js")).href);
  const t = s.newToken();
  check("token ยาว 64 hex", /^[0-9a-f]{64}$/.test(t), true);
  check("token สุ่มไม่ซ้ำ", s.newToken() === t, false);
  check("ตรงกัน", s.tokensMatch(t, t), true);
  check("ไม่ตรง", s.tokensMatch("a".repeat(64), t), false);
  check("ความยาวไม่เท่า ไม่ throw", s.tokensMatch("abc", t), false);
  check("null", s.tokensMatch(null, t), false);
  check("protocol", s.SCANNER_PROTOCOL, "showcase-scanner/1");
  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
  if (failed > 0) process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
```

Run: `node scripts/check-scanner-link.mjs` → Expected: FAIL (ไม่มีไฟล์ lib/scanner-link.ts)

- [ ] **Step 3: `lib/scanner-link.ts`**

```ts
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ลิงก์ปลายทางของ Showcase Scanner ฝั่ง Angle — protocol เดียวกับที่คนอื่นใช้ (ดู
 * showcase-extension/docs/INTEGRATION.md) · ใช้ฝั่ง server เท่านั้น (มี node:crypto)
 */
export const SCANNER_PROTOCOL = "showcase-scanner/1";

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** เทียบแบบ timing-safe — ความยาวต่างกันคืน false ก่อน (timingSafeEqual throw ถ้ายาวไม่เท่า) */
export function tokensMatch(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Run: `node scripts/check-scanner-link.mjs` → Expected: `ผ่านทุกเคส`

- [ ] **Step 4: actions + route**

`app/actions.ts` เพิ่ม (import `newToken` จาก `@/lib/scanner-link`):

```ts
/** token ของลิงก์ปลายทาง Showcase Scanner — สร้างครั้งแรกที่มีคนขอ */
export async function getScannerToken(): Promise<string> {
  const row = await prisma.scannerLink.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", token: newToken() },
    update: {},
  });
  return row.token;
}

/** "สร้างลิงก์ใหม่" — ลิงก์เก่าใช้ไม่ได้ทันที (extension จะเห็นไฟแดง "ลิงก์ใช้ไม่ได้แล้ว") */
export async function regenerateScannerToken(): Promise<string> {
  const token = newToken();
  await prisma.scannerLink.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", token },
    update: { token, createdAt: new Date() },
  });
  revalidatePath("/products");
  return token;
}
```

`app/api/scanner/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importShowcaseBatch } from "@/app/actions";
import { SHOWCASE_CORS_HEADERS } from "@/lib/cors";
import { SCANNER_PROTOCOL, tokensMatch } from "@/lib/scanner-link";

/**
 * ลิงก์ปลายทางของ Showcase Scanner (protocol showcase-scanner/1 — showcase-extension/docs/INTEGRATION.md)
 * แทน /api/showcase-import + /known-ids + /health เดิม · token มาจาก query (ADR 0001) เทียบกับแถว
 * ScannerLink · POST มาเป็น text/plain (simple request ไม่มี preflight) จึงต้อง JSON.parse เอง
 */
const unauthorized = () =>
  NextResponse.json({ error: "unauthorized" }, { status: 401, headers: SHOWCASE_CORS_HEADERS });

async function authorized(req: NextRequest): Promise<boolean> {
  const row = await prisma.scannerLink.findUnique({ where: { id: "singleton" } });
  return row !== null && tokensMatch(req.nextUrl.searchParams.get("token"), row.token);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: SHOWCASE_CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return unauthorized();
  const [rows, lastBatch] = await Promise.all([
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
      protocol: SCANNER_PROTOCOL,
      productIds: rows.map((r) => r.sourceProductId).filter((id): id is string => id !== null),
      lastReceivedAt: lastBatch?.capturedOn.toISOString() ?? null,
    },
    { headers: SHOWCASE_CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return unauthorized();
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: SHOWCASE_CORS_HEADERS });
  }
  try {
    const result = await importShowcaseBatch(body);
    return NextResponse.json({ ok: true, ...result }, { headers: SHOWCASE_CORS_HEADERS });
  } catch (e) {
    const message = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ error: message }, { status: 400, headers: SHOWCASE_CORS_HEADERS });
  }
}
```

`lib/cors.ts`: `Access-Control-Allow-Headers` เหลือ `"content-type"` และคอมเมนต์หัวไฟล์เปลี่ยนเป็น "ใช้กับ `/api/scanner` (ลิงก์ปลายทางของ Showcase Scanner) เท่านั้น"

ลบ 3 ไฟล์ route เดิม แล้ว `grep -rn "showcase-import/\|x-showcase-secret\|SHOWCASE_IMPORT_SECRET" app lib components` ต้องว่าง (ยกเว้นชื่อไฟล์ `lib/showcase-import.ts` ซึ่งยังใช้อยู่)

- [ ] **Step 5: เทสจริงบน dev server แยก**

```bash
npx tsc --noEmit && npm run lint
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001   # background
```

แล้วเขียนสคริปต์ node ใน scratch (require `better-sqlite3` ด้วย absolute path) อ่าน token จาก `dev-test.db` (`SELECT token FROM ScannerLink`) — ถ้ายังไม่มีแถว ให้เปิด `http://localhost:3001/products` หนึ่งครั้งหลัง Task 7 หรือ insert ผ่าน `getScannerToken` — แล้ว curl:
- `GET /api/scanner` (ไม่มี token) → 401
- `GET /api/scanner?token=<token>` → 200, `protocol` = `showcase-scanner/1`, `productIds.length` = 197
- `POST /api/scanner?token=<token>` body `{}` content-type `text/plain` → 400 (ไม่มี products) — พิสูจน์ว่าผ่าน auth และ parse text/plain
- `OPTIONS` → 204 + `access-control-allow-origin: *`
- เรียก `regenerateScannerToken` (ผ่าน UI Task 7 หรือ node script ที่ update token) แล้ว GET ด้วย token เก่า → 401 **(Review Focus 2)**

ปิด dev server, `git checkout -- tsconfig.json` ถ้าถูกแก้

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260929120000_add_scanner_link lib/scanner-link.ts scripts/check-scanner-link.mjs app/api/scanner app/actions.ts lib/cors.ts
git rm -r app/api/showcase-import
git commit -m "Angle: /api/scanner destination link (token in DB) replaces secret-header import routes"
```

---

### Task 7: Angle — กล่อง "ลิงก์สำหรับ Showcase Scanner" ในหน้าหาสินค้า

**Files:**
- Create: `components/scanner-link-box.tsx`
- Modify: `app/products/page.tsx` (ดึง token ส่งเป็น prop), `components/candidates-route.tsx` (รับ prop + วางกล่องใต้ฟอร์ม "นำเข้าจากไฟล์ Showcase (.json)")

**Interfaces:** Consumes (Task 6): `getScannerToken()`, `regenerateScannerToken()`

- [ ] **Step 1: คอมโพเนนต์**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { regenerateScannerToken } from "@/app/actions";

/**
 * ลิงก์ปลายทางให้วางใน Showcase Scanner (ADR 0001) — ประกอบ URL ฝั่ง client ด้วย window.location.origin
 * เพราะ server ไม่รู้ว่าผู้ใช้เปิดแอปผ่าน host ไหน · "สร้างลิงก์ใหม่" ทำให้ลิงก์เก่าใช้ไม่ได้ทันที
 * จึงต้องกดยืนยันสองจังหวะ
 */
export function ScannerLinkBox({ token }: { token: string }) {
  const [current, setCurrent] = useState(token);
  const [origin, setOrigin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => setOrigin(window.location.origin), []);
  const link = origin === "" ? "" : `${origin}/api/scanner?token=${current}`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <p className="text-sm leading-relaxed text-foreground">
        ลิงก์สำหรับ Showcase Scanner — วางใน extension ที่ ตั้งค่า → ลิงก์ปลายทาง (ทำครั้งเดียว)
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={link === ""}
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => setMessage("คัดลอกลิงก์แล้ว"));
          }}
        >
          <Copy className="size-4" />
          คัดลอกลิงก์
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              setMessage("กดอีกครั้งเพื่อยืนยัน — ลิงก์เดิมใน extension จะใช้ไม่ได้ทันที");
              return;
            }
            setArmed(false);
            startTransition(async () => {
              setCurrent(await regenerateScannerToken());
              setMessage("สร้างลิงก์ใหม่แล้ว — คัดลอกไปวางใน extension ใหม่");
            });
          }}
        >
          <RefreshCw className="size-4" />
          {armed ? "ยืนยันสร้างลิงก์ใหม่" : "สร้างลิงก์ใหม่"}
        </Button>
      </div>
      {message && <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: ต่อเข้าหน้า** — `app/products/page.tsx`: `const [data, scannerToken] = await Promise.all([getCandidatesData(), getScannerToken()]);` (import `getScannerToken` จาก `@/app/actions`) ส่ง `scannerToken={scannerToken}` · `CandidatesRoute` รับ prop `scannerToken: string` แล้ววาง `<ScannerLinkBox token={scannerToken} />` ต่อจาก `</form>` ของฟอร์มนำเข้าไฟล์ Showcase

- [ ] **Step 3: ตรวจ**

```bash
npx tsc --noEmit && npm run lint && node scripts/check-contrast.mjs
```

รัน dev server แยก (เหมือน Task 6) แล้วถ่ายภาพ `/products` ที่ 1440px และ 390px (`hasTouch: true`) ด้วย Playwright — ต้องเห็นกล่อง, ปุ่มสูง 44px ที่ 390px, ไม่มีสกรอลแนวนอน · กด "คัดลอกลิงก์" (context ต้องมี `permissions: ['clipboard-read','clipboard-write']`) แล้วอ่าน clipboard ต้องได้ `http://localhost:3001/api/scanner?token=<64 hex>` · กด "สร้างลิงก์ใหม่" 2 ครั้ง → token ใน clipboard หลังคัดลอกใหม่ต้องเปลี่ยน และ GET ด้วย token เก่าได้ 401 · ปิด dev server, `git checkout -- tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add components/scanner-link-box.tsx components/candidates-route.tsx app/products/page.tsx
git commit -m "Angle: copy / regenerate the Showcase Scanner destination link on the products page"
```

---

### Task 8: เอกสารสำหรับ AI coding agent + คู่มือติดตั้ง + zip

**Files:**
- Create: `showcase-extension/docs/INTEGRATION.md`, `showcase-extension/docs/INSTALL.md`
- Create: `showcase-extension/docs/examples/apps-script.gs`, `showcase-extension/docs/examples/express.js`, `showcase-extension/docs/examples/nextjs-route.ts`
- Create: `showcase-extension/scripts/package.mjs` · Modify: `showcase-extension/package.json` (`"package": "npm run build && node scripts/package.mjs"`)

- [ ] **Step 1: `INTEGRATION.md`** — เขียนให้ agent อ่านแล้วทำได้ทันที ต้องมีหัวข้อ (ภาษาไทย + ตัวอย่างโค้ดภาษาอังกฤษ):
  1. "สิ่งที่คุณต้องสร้าง" — endpoint เดียวที่ URL มี token (`?token=`) เป็นรหัส; ต้องสร้าง token สุ่ม ≥ 32 ไบต์ และมีวิธีเปลี่ยนใหม่
  2. `POST <link>` — body เป็น **ข้อความ** JSON (Content-Type `text/plain;charset=utf-8`) ต้อง `JSON.parse(rawBody)` เอง · ตอบ 2xx = รับ · token ผิด → 401 · ตัวอย่าง payload จริง (ก๊อปจากผล `run.export` หนึ่งก้อน ตัดเหลือสินค้า 1 ตัว) พร้อมตาราง field ของ `products[]`: `productId` (string — ห้ามแปลงเป็น number, ยาวเกิน 2^53), `title`, `priceDisplay`, `priceAmountDecimal`, `currency`, `commissionRate` (เปอร์เซ็นต์ เช่น `11` = 11%), `shopName`, `imageUrls`, `categoryLabel`, `hasStatusPopup` (true = สินค้าตายแล้ว ควรข้าม), `schemaVersion`
  3. **ส่งซ้ำได้** — ตัวเดียวกันอาจถูกส่งมากกว่าหนึ่งครั้ง (ผู้ใช้กดลืมความจำ/เปลี่ยนเครื่อง) ให้ upsert ด้วย `productId`
  4. `GET <link>` (แนะนำ) — ตอบ `{"protocol":"showcase-scanner/1","productIds":[...],"lastReceivedAt":"<ISO>"|null}` → ไฟเขียว + หยุดสแกนเอง; ไม่ทำ = ไฟเทา แต่ใช้งานได้
  5. CORS: ทุก response ต้องมี `Access-Control-Allow-Origin: *`; ถ้าเฟรมเวิร์กตอบ OPTIONS ได้ ให้ตอบ 204 + header เดียวกัน
  6. https บังคับ ยกเว้น localhost
  7. ตารางผลที่ extension แสดงตาม status code (2xx / 401,403 / 5xx / อื่นๆ)
  8. ชี้ไปตัวอย่าง 3 ไฟล์ + "Checklist ก่อนส่งลิงก์ให้ผู้ใช้" (curl GET ไม่มี token ได้ 401, มี token ได้ JSON ถูกรูป, POST ตัวอย่าง payload ได้ 2xx)

- [ ] **Step 2: ตัวอย่าง 3 ไฟล์** — `apps-script.gs`: `doPost(e)` อ่าน `e.parameter.token` เทียบกับ `PropertiesService.getScriptProperties().getProperty('TOKEN')`, `JSON.parse(e.postData.contents)`, append/อัปเดตแถวในชีต `Products` (คอลัมน์ productId, title, priceDisplay, commissionRate, shopName, categoryLabel, imageUrl แรก, receivedAt) โดยหาแถวเดิมด้วย productId; `doGet(e)` คืน `ContentService.createTextOutput(JSON.stringify({protocol, productIds, lastReceivedAt})).setMimeType(ContentService.MimeType.JSON)`; หมายเหตุ: Apps Script ตอบ 401 ไม่ได้ (คืน 200 เสมอ) — ถ้า token ผิดให้คืน `{"error":"unauthorized"}` และไม่เขียนอะไร (protocol กำหนดให้ extension ถือว่าเป็น "ลิงก์ใช้ไม่ได้" เหมือน 401 — เขียนกฎนี้ไว้ใน INTEGRATION.md หัวข้อ 2 ด้วย) · `express.js`: `express.text({ type: '*/*' })`, middleware CORS, `app.get/post('/scanner')` เก็บใน Map · `nextjs-route.ts`: route handler แบบเดียวกับ `app/api/scanner/route.ts` ของ Angle แต่เก็บลง storage สมมติ (ฟังก์ชัน `saveProducts`/`listProductIds` ให้ผู้ใช้เติม) — **ต้องเป็นโค้ดที่รันได้จริงครบไฟล์ ไม่มี TODO ในส่วน protocol**

- [ ] **Step 3: `INSTALL.md`** — สำหรับคนรู้จัก: แตก zip → Brave/Chrome ไปที่ `brave://extensions` หรือ `chrome://extensions` → เปิด Developer mode → Load unpacked → เลือกโฟลเดอร์ที่แตก → ล็อกอิน TikTok Shop ในเบราว์เซอร์เดียวกัน → กดไอคอน → เปิดหน้าจัดการ → ตั้งค่า → วางลิงก์ปลายทาง · อัปเดต: แตก zip ใหม่ทับโฟลเดอร์เดิม แล้วกด ↻ ที่การ์ด extension (ลิงก์และความจำยังอยู่) · ส่งหลายปลายทาง: ใช้คนละโปรไฟล์เบราว์เซอร์ · ไม่มีระบบของตัวเอง: ให้ AI coding agent อ่าน `INTEGRATION.md`

- [ ] **Step 4: `scripts/package.mjs`**

```js
/**
 * zip สำหรับแจก — dist-release + คู่มือ + เอกสาร integration + ตัวอย่าง
 * รันผ่าน `npm run package` (build ก่อนเสมอ) · ใช้ PowerShell Compress-Archive เพราะเครื่องเจ้าของเป็น Windows
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const version = JSON.parse(readFileSync("extension/manifest.json", "utf8")).version;
const stage = resolve(`dist-zip/showcase-scanner-${version}`);
rmSync("dist-zip", { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync("dist-release", join(stage, "extension"), { recursive: true, filter: (src) => !src.endsWith("meta.json") });
cpSync("docs/INSTALL.md", join(stage, "INSTALL.md"));
cpSync("docs/INTEGRATION.md", join(stage, "INTEGRATION.md"));
cpSync("docs/examples", join(stage, "examples"), { recursive: true });
const zip = resolve(`dist-zip/showcase-scanner-${version}.zip`);
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
console.log(`packaged → ${zip}`);
```

เพิ่ม `showcase-extension/dist-zip/` ใน `.gitignore` ของ root (ส่วน showcase-extension)

- [ ] **Step 5: ตรวจ**

```bash
cd showcase-extension && npm run package
powershell -NoProfile -Command "(Get-ChildItem -Recurse dist-zip/showcase-scanner-0.2.0 | Measure-Object).Count; Test-Path dist-zip/showcase-scanner-0.2.0/extension/manifest.json"
```

Expected: zip ถูกสร้าง, มี `extension/manifest.json`, `INSTALL.md`, `INTEGRATION.md`, `examples/*` · โหลด `dist-zip/showcase-scanner-0.2.0/extension` แบบ unpacked ในโปรไฟล์ Playwright ใหม่ → ต้องโหลดได้และ popup ขึ้น "ยังไม่ได้ใส่ลิงก์ปลายทาง" · `grep -c "meta.json"` ในรายการไฟล์ zip = 0 · และ `grep -rn "token=[0-9a-f]\{64\}" dist-zip` ต้องว่าง (ไม่มี token จริงหลุดในเอกสาร)

- [ ] **Step 6: Commit**

```bash
git add showcase-extension/docs/INTEGRATION.md showcase-extension/docs/INSTALL.md showcase-extension/docs/examples showcase-extension/scripts/package.mjs showcase-extension/package.json .gitignore
git commit -m "Showcase Scanner: agent-facing integration guide, install guide, zip packaging"
```

---

### Task 9: เปลี่ยนระบบจริงของเจ้าของ + อัปเดตเอกสาร

**ต้องมีผู้ใช้ร่วม** — แตะ `dev.db` จริงและต้องรีสตาร์ต server ของผู้ใช้

- [ ] **Step 1: ถามผู้ใช้ก่อน** ว่าตอนนี้ไม่มีงานบอท Flow วิ่งอยู่และรีสตาร์ตได้ไหม (CLAUDE.md: ห้าม kill server เอง)
- [ ] **Step 2: backup + migrate จริง**

สคริปต์ node (absolute require `better-sqlite3`) รัน `PRAGMA wal_checkpoint(TRUNCATE)` กับ `dev.db` แล้วก๊อป `dev.db`, `dev.db-wal`, `dev.db-shm` ไปเป็น `dev-backup-2026-09-29-scanner-link.db*` (pattern `/dev-backup-*.db` gitignore แล้ว) · จากนั้น `npx prisma migrate deploy` (DATABASE_URL จาก `.env` = dev.db) · Expected: `1 migration applied` — อย่างอื่นให้หยุดและรายงาน

- [ ] **Step 3:** `npx prisma generate` → ผู้ใช้กด `stop.bat` → `start.bat` (build ใหม่เพราะ app/lib/prisma เปลี่ยน) → เช็ก `pp-server.log` ว่า Ready
- [ ] **Step 4:** ผู้ใช้: หน้า "หาสินค้า" → คัดลอกลิงก์ → extension โหลดใหม่จาก `showcase-extension/dist-release` (↻) → หน้าจัดการ → ตั้งค่า → วางลิงก์ → popup ต้องเป็นไฟเขียว "197 สินค้าที่ปลายทาง"
- [ ] **Step 5:** ผู้ใช้เพิ่มสินค้าใหม่ใน Showcase แล้วกด "สแกนสินค้าใหม่ → ส่งไปปลายทาง" — ต้องหยุดเอง (`known_ids_reached`) ส่งเฉพาะตัวใหม่ และหน้า "หาสินค้า" ยังเห็นสินค้าเก่าครบ + ตัวใหม่
- [ ] **Step 6: เอกสาร** — `CLAUDE.md`: เพิ่มหัวข้อสั้น "Showcase Scanner ↔ Angle" (route `/api/scanner`, token ใน `ScannerLink`, ห้ามกลับไปใช้ secret header, ลิงก์ ADR/สเปก/INTEGRATION.md) · `showcase-extension/docs/api-observations.md`: ย่อหน้าที่อ้าง `x-showcase-secret`/`/api/showcase-import` แก้ให้ชี้ protocol ใหม่ · บอกผู้ใช้ว่าลบบรรทัด `SHOWCASE_IMPORT_SECRET` ใน `.env` ได้ (ไม่แก้ `.env` เอง)
- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md showcase-extension/docs/api-observations.md
git commit -m "Docs: Showcase Scanner destination link is the only Angle import path"
```
