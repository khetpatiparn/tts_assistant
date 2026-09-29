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
