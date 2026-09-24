import { describe, it, expect } from 'vitest'
import { buildShowcaseRequest, createLiveShowcaseAdapter } from '../../extension/src/adapters/live-showcase.js'
import { ADAPTER_VERSION_LIVE } from '../../extension/src/domain/version.js'
import { ScannerError } from '../../extension/src/domain/errors.js'
import type { LiveTransport, LiveTransportOutcome, LiveTransportRequest } from '../../extension/src/adapters/live-transport.js'

/**
 * ทดสอบชั้น adapter ล้วน ๆ ด้วย fake LiveTransport + fake permission checker — ไม่มี fetch,
 * ไม่มี chrome.permissions, ไม่มี network เลยแม้แต่นิดเดียว พิสูจน์ว่า request/transport/
 * permission-check/response-translation แยกกันทดสอบได้จริงตามที่โจทย์ต้องการ
 */
const fakeTransport = (
  respond: (req: LiveTransportRequest) => LiveTransportOutcome,
): LiveTransport & { calls: LiveTransportRequest[] } => {
  const calls: LiveTransportRequest[] = []
  return {
    calls,
    send(req) {
      calls.push(req)
      return Promise.resolve(respond(req))
    },
  }
}

/** ค่า default ของทุกเทสต์ในไฟล์นี้ที่ไม่ได้ตั้งใจทดสอบเรื่อง permission โดยตรง — ถือว่ามีสิทธิ์แล้ว */
const granted = (): Promise<boolean> => Promise.resolve(true)

describe('buildShowcaseRequest — hostname/path hardcode ตาม observed evidence เท่านั้น (docs/api-observations.md §1)', () => {
  it('ประกอบ URL ตรงกับ endpoint ที่สังเกตได้จริงเป๊ะ', () => {
    const built = buildShowcaseRequest({ offset: 0, count: 6 })
    expect(built.method).toBe('GET')
    expect(built.url).toBe(
      'https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list?offset=0&count=6',
    )
  })

  it('offset/count ต่างค่าสะท้อนใน query string ตรงตัว', () => {
    const built = buildShowcaseRequest({ offset: 198, count: 6 })
    expect(built.url).toContain('offset=198')
    expect(built.url).toContain('count=6')
  })

  it('ไม่มีทางประกอบ URL จาก field อื่นได้เลย — ShowcasePageRequest มีแค่ offset/count', () => {
    // ถ้ามีใครพยายามแนบ field แปลกปลอมเข้ามา (เช่นผ่าน object spread จาก message ที่ validate.ts
    // ควรบล็อกไปแล้วชั้นบน) ฟังก์ชันนี้ก็ยังอ่านแค่ offset/count จริง ๆ เท่านั้น พิสูจน์ด้วยการยัด key แปลก
    // ผ่าน unknown เพื่อเลี่ยง excess-property check ของ TS ซึ่งเป็นแค่ compile-time — ที่ต้องการพิสูจน์
    // คือ runtime behavior ว่าโค้ดจริงเพิกเฉยต่อ field เกิน
    const malicious: unknown = { offset: 0, count: 6, url: 'https://evil.test/steal', path: '/evil' }
    const built = buildShowcaseRequest(malicious as { offset: number; count: number })
    expect(built.url).not.toContain('evil')
    expect(built.url.startsWith('https://shop.tiktok.com/')).toBe(true)
  })

  it('offset/count ที่ผิดกฎ (ติดลบ, ไม่ใช่ safe integer, count<=0) ถูกปฏิเสธก่อนประกอบ request', () => {
    for (const bad of [
      { offset: -1, count: 6 },
      { offset: 1.5, count: 6 },
      { offset: 0, count: 0 },
      { offset: 0, count: -6 },
      { offset: Number.MAX_SAFE_INTEGER + 2, count: 6 },
    ]) {
      expect(() => buildShowcaseRequest(bad), JSON.stringify(bad)).toThrow(/adapter_invalid_request/)
    }
  })
})

describe('createLiveShowcaseAdapter — แปล transport outcome เป็น ShowcaseAdapter contract', () => {
  it('ประกาศ mode และ adapterVersion ถูกต้อง', () => {
    const adapter = createLiveShowcaseAdapter({
      transport: fakeTransport(() => ({ kind: 'response', httpStatus: 200, headers: {}, bodyText: '{}' })),
      hasHostPermission: granted,
    })
    expect(adapter.mode).toBe('live')
    expect(adapter.adapterVersion).toBe(ADAPTER_VERSION_LIVE)
  })

  it('response สำเร็จคืน ShowcaseRawPage ตรงตัว ไม่ parse ไม่แตะเนื้อหา', async () => {
    const bodyText = '{"code":0,"message":"success","data":{"products":[],"total":201}}'
    const transport = fakeTransport(() => ({
      kind: 'response',
      httpStatus: 200,
      headers: { 'content-type': 'application/json' },
      bodyText,
    }))
    const adapter = createLiveShowcaseAdapter({ transport, hasHostPermission: granted })
    const page = await adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)
    expect(page).toEqual({
      httpStatus: 200,
      headers: { 'content-type': 'application/json' },
      bodyText,
    })
  })

  it('offset/count ที่ขอ ถูกส่งต่อไปยัง transport เป็น URL ที่ประกอบถูกต้อง', async () => {
    const transport = fakeTransport(() => ({ kind: 'response', httpStatus: 200, headers: {}, bodyText: '{}' }))
    const adapter = createLiveShowcaseAdapter({ transport, hasHostPermission: granted })
    await adapter.fetchPage({ offset: 6, count: 6 }, new AbortController().signal)
    expect(transport.calls).toHaveLength(1)
    expect(transport.calls[0]?.url).toContain('offset=6&count=6')
    expect(transport.calls[0]?.method).toBe('GET')
  })

  it('redirect_blocked จาก transport กลายเป็น ScannerError adapter_redirect_blocked', async () => {
    const adapter = createLiveShowcaseAdapter({
      transport: fakeTransport(() => ({ kind: 'redirect_blocked' })),
      hasHostPermission: granted,
    })
    await expect(adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).rejects.toMatchObject(
      { code: 'adapter_redirect_blocked' },
    )
  })

  it('timeout จาก transport กลายเป็น ScannerError adapter_timeout', async () => {
    const adapter = createLiveShowcaseAdapter({
      transport: fakeTransport(() => ({ kind: 'timeout' })),
      hasHostPermission: granted,
    })
    await expect(adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).rejects.toMatchObject(
      { code: 'adapter_timeout' },
    )
  })

  it('network_error จาก transport กลายเป็น ScannerError adapter_network_error', async () => {
    const adapter = createLiveShowcaseAdapter({
      transport: fakeTransport(() => ({ kind: 'network_error' })),
      hasHostPermission: granted,
    })
    await expect(adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).rejects.toMatchObject(
      { code: 'adapter_network_error' },
    )
  })

  it('body_too_large จาก transport กลายเป็น ScannerError adapter_body_too_large', async () => {
    const adapter = createLiveShowcaseAdapter({
      transport: fakeTransport(() => ({ kind: 'body_too_large' })),
      hasHostPermission: granted,
    })
    await expect(adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).rejects.toMatchObject(
      { code: 'adapter_body_too_large' },
    )
  })

  it('aborted จาก transport กลายเป็น ScannerError aborted', async () => {
    const adapter = createLiveShowcaseAdapter({
      transport: fakeTransport(() => ({ kind: 'aborted' })),
      hasHostPermission: granted,
    })
    await expect(adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).rejects.toMatchObject(
      { code: 'aborted' },
    )
  })

  it('signal ที่ถูก abort ไปแล้วก่อนเรียก ถูกปฏิเสธทันทีโดยไม่ยิง transport เลย', async () => {
    const transport = fakeTransport(() => ({ kind: 'response', httpStatus: 200, headers: {}, bodyText: '{}' }))
    const adapter = createLiveShowcaseAdapter({ transport, hasHostPermission: granted })
    const controller = new AbortController()
    controller.abort()
    await expect(adapter.fetchPage({ offset: 0, count: 6 }, controller.signal)).rejects.toMatchObject({
      code: 'aborted',
    })
    expect(transport.calls).toHaveLength(0)
  })

  it('offset/count ที่ผิดกฎ ถูกปฏิเสธก่อนยิง transport เลย (ไม่ใช่ยิงไปแล้วค่อยพัง)', async () => {
    const transport = fakeTransport(() => ({ kind: 'response', httpStatus: 200, headers: {}, bodyText: '{}' }))
    const adapter = createLiveShowcaseAdapter({ transport, hasHostPermission: granted })
    await expect(adapter.fetchPage({ offset: -1, count: 6 }, new AbortController().signal)).rejects.toBeInstanceOf(
      ScannerError,
    )
    expect(transport.calls).toHaveLength(0)
  })
})

describe('createLiveShowcaseAdapter — permission prerequisite (spec §7.1, ไม่เพิ่มสิทธิ์เกิน spec)', () => {
  it('ไม่มีสิทธิ์ host permission → throw permission_required ก่อนยิง transport เลย', async () => {
    const transport = fakeTransport(() => ({ kind: 'response', httpStatus: 200, headers: {}, bodyText: '{}' }))
    const adapter = createLiveShowcaseAdapter({
      transport,
      hasHostPermission: () => Promise.resolve(false),
    })
    await expect(adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).rejects.toMatchObject({
      code: 'permission_required',
    })
    // จุดสำคัญ: ไม่มีการยิง network ใด ๆ เลยเมื่อไม่มีสิทธิ์ — ไม่ใช่ยิงไปก่อนแล้วค่อยพัง
    expect(transport.calls).toHaveLength(0)
  })

  it('มีสิทธิ์แล้ว → เดินหน้าต่อไปเรียก transport ตามปกติ', async () => {
    const transport = fakeTransport(() => ({ kind: 'response', httpStatus: 200, headers: {}, bodyText: '{}' }))
    const adapter = createLiveShowcaseAdapter({ transport, hasHostPermission: granted })
    await adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)
    expect(transport.calls).toHaveLength(1)
  })

  it('เช็คสิทธิ์ใหม่ทุกครั้งที่เรียก fetchPage — ไม่ cache ผลจากครั้งก่อน', async () => {
    let call = 0
    const permissionResults = [true, false, true]
    const transport = fakeTransport(() => ({ kind: 'response', httpStatus: 200, headers: {}, bodyText: '{}' }))
    const adapter = createLiveShowcaseAdapter({
      transport,
      hasHostPermission: () => Promise.resolve(permissionResults[call++] ?? false),
    })

    await expect(adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).resolves.toBeDefined()
    await expect(adapter.fetchPage({ offset: 6, count: 6 }, new AbortController().signal)).rejects.toMatchObject({
      code: 'permission_required',
    })
    await expect(adapter.fetchPage({ offset: 12, count: 6 }, new AbortController().signal)).resolves.toBeDefined()
    expect(transport.calls).toHaveLength(2)
  })
})
