import { describe, it, expect } from 'vitest'
import {
  createFetchTransport,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_TIMEOUT_MS,
} from '../../extension/src/adapters/live-transport.js'
import type { LiveTransportRequest } from '../../extension/src/adapters/live-transport.js'

/**
 * ทดสอบ transport จริง (createFetchTransport) โดย inject fetchImpl ปลอมแทน globalThis.fetch
 * เสมอ — globalThis.fetch ถูกล็อกให้ throw E_NETWORK_DENIED ใน test environment นี้อยู่แล้ว
 * (tests/setup/no-network.ts, R15) ไฟล์นี้จึงไม่มีทาง (และไม่จำเป็นต้อง) แตะ network จริงเลย
 *
 * fetchImpl ปลอมคืน object ที่หน้าตาเหมือน Response เท่าที่ transport ใช้จริง (status, headers,
 * body, type) — ไม่ใช่ instance จริงของ Response เพราะ `type: 'opaqueredirect'` ตั้งไม่ได้ผ่าน
 * `new Response()` (เป็น read-only property ที่ browser กำหนดจากวิธีที่ได้ response มา ไม่ใช่จาก
 * constructor) จึงต้อง duck-type แทน — transport เข้าถึงแค่ field ที่ระบุไว้เท่านั้น
 */

const fakeResponse = (init: {
  status?: number
  headers?: Record<string, string>
  bodyChunks?: readonly Uint8Array[]
  type?: string
}): Response => {
  const headers = new Headers(init.headers ?? {})
  const chunks = init.bodyChunks ?? [new TextEncoder().encode('{}')]
  let pulled = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < chunks.length) {
        controller.enqueue(chunks[pulled] as Uint8Array)
        pulled += 1
      } else {
        controller.close()
      }
    },
  })
  return {
    status: init.status ?? 200,
    headers,
    body,
    type: init.type ?? 'basic',
  } as unknown as Response
}

const REQ: LiveTransportRequest = {
  method: 'GET',
  url: 'https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list?offset=0&count=6',
  signal: new AbortController().signal,
}

describe('createFetchTransport — request shape (spec §9.2 ข้อ 3, ไม่แก้ Cookie header เอง)', () => {
  it('ส่งด้วย GET, credentials:include, cache:no-store, redirect:manual เสมอ ไม่มี header cookie', async () => {
    let capturedInit: RequestInit | undefined
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      capturedInit = init
      return Promise.resolve(fakeResponse({}))
    }) as typeof fetch

    const transport = createFetchTransport({ fetchImpl })
    await transport.send(REQ)

    expect(capturedInit?.method).toBe('GET')
    expect(capturedInit?.credentials).toBe('include')
    expect(capturedInit?.cache).toBe('no-store')
    expect(capturedInit?.redirect).toBe('manual')
    // ไม่เคยตั้ง header เอง (ปล่อยให้ browser แนบ session ตามกลไกปกติ) — headers ไม่ถูกส่งมาเลย
    expect(capturedInit?.headers).toBeUndefined()
  })

  it('URL ที่ยิงจริงตรงกับที่ caller ส่งมาเป๊ะ ไม่แก้ไขระหว่างทาง', async () => {
    let capturedUrl = ''
    const fetchImpl = ((url: string) => {
      capturedUrl = url
      return Promise.resolve(fakeResponse({}))
    }) as typeof fetch

    const transport = createFetchTransport({ fetchImpl })
    await transport.send(REQ)
    expect(capturedUrl).toBe(REQ.url)
  })
})

describe('createFetchTransport — อ่าน response สำเร็จ', () => {
  it('คืน httpStatus/headers/bodyText ตรงตัว', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        fakeResponse({
          status: 200,
          headers: { 'content-type': 'application/json' },
          bodyChunks: [new TextEncoder().encode('{"code":0,"message":"success","data":{}}')],
        }),
      )) as typeof fetch

    const transport = createFetchTransport({ fetchImpl })
    const outcome = await transport.send(REQ)

    expect(outcome).toEqual({
      kind: 'response',
      httpStatus: 200,
      headers: { 'content-type': 'application/json' },
      bodyText: '{"code":0,"message":"success","data":{}}',
    })
  })

  it('รวมหลาย chunk ของ stream เข้าเป็นข้อความเดียวถูกต้อง', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        fakeResponse({
          bodyChunks: [
            new TextEncoder().encode('{"a":'),
            new TextEncoder().encode('1,"b":'),
            new TextEncoder().encode('2}'),
          ],
        }),
      )) as typeof fetch

    const transport = createFetchTransport({ fetchImpl })
    const outcome = await transport.send(REQ)
    if (outcome.kind !== 'response') throw new Error(outcome.kind)
    expect(outcome.bodyText).toBe('{"a":1,"b":2}')
  })
})

describe('createFetchTransport — redirect ที่ไม่ตามอัตโนมัติ (spec §9.2 ข้อ 4)', () => {
  it('opaqueredirect (จาก redirect:manual) กลายเป็น redirect_blocked ไม่ใช่ error ทั่วไป', async () => {
    const fetchImpl = (() =>
      Promise.resolve(fakeResponse({ type: 'opaqueredirect', status: 0 }))) as typeof fetch

    const transport = createFetchTransport({ fetchImpl })
    const outcome = await transport.send(REQ)
    expect(outcome).toEqual({ kind: 'redirect_blocked' })
  })
})

describe('createFetchTransport — network error และ cancellation', () => {
  it('fetch ที่ reject เพราะเครือข่ายเสีย กลายเป็น network_error', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch
    const transport = createFetchTransport({ fetchImpl })
    const outcome = await transport.send(REQ)
    expect(outcome).toEqual({ kind: 'network_error' })
  })

  it('caller ยกเลิกเอง (AbortController.abort()) กลายเป็น aborted ไม่ใช่ network_error หรือ timeout', async () => {
    const controller = new AbortController()
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch

    const transport = createFetchTransport({ fetchImpl })
    const pending = transport.send({ ...REQ, signal: controller.signal })
    controller.abort()
    const outcome = await pending
    expect(outcome).toEqual({ kind: 'aborted' })
  })

  it('ไม่มี response มาภายในเวลาที่กำหนด กลายเป็น timeout ไม่ใช่ aborted', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch

    // timeout สั้นมากเพื่อไม่ให้ test ช้า — caller signal ไม่เคยถูก abort เอง
    const transport = createFetchTransport({ fetchImpl, timeoutMs: 15 })
    const outcome = await transport.send(REQ)
    expect(outcome).toEqual({ kind: 'timeout' })
  })
})

describe('createFetchTransport — จำกัดขนาด body ระหว่างอ่านจริง ไม่ใช่เช็คหลังอ่านจบ (V14)', () => {
  it('body ที่เกิน cap ถูกตัดและ cancel reader กลางทาง ไม่ดึง chunk ที่เหลือทั้งหมด', async () => {
    const bigChunk = new Uint8Array(50) // 50 ไบต์ต่อ chunk
    let chunksServed = 0
    const totalChunksAvailable = 100 // รวม 5,000 ไบต์ ถ้าอ่านหมด — เกิน cap 120 ไบต์แน่นอน

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksServed < totalChunksAvailable) {
          chunksServed += 1
          controller.enqueue(bigChunk)
        } else {
          controller.close()
        }
      },
    })

    const fetchImpl = (() =>
      Promise.resolve({ status: 200, headers: new Headers(), body, type: 'basic' } as unknown as Response)) as typeof fetch

    const transport = createFetchTransport({ fetchImpl, maxBodyBytes: 120 })
    const outcome = await transport.send(REQ)

    expect(outcome).toEqual({ kind: 'body_too_large' })
    // ตัดตั้งแต่ chunk แรก ๆ (120/50 = 3 chunk ก็เกินแล้ว) ไม่ใช่อ่านครบทั้ง 100 chunk ก่อนค่อยเช็ค
    expect(chunksServed).toBeLessThan(totalChunksAvailable)
  })

  it('ค่า default ตรงตาม spec §9.4/V14 — timeout 20 วินาที, body cap 2 MiB', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(20_000)
    expect(DEFAULT_MAX_BODY_BYTES).toBe(2 * 1024 * 1024)
  })

  it('fallback เมื่อ response.body เป็น null (บาง environment ไม่ให้ stream) ยังจำกัดขนาดได้', async () => {
    const smallText = '{"code":0}'
    const fetchImpl = (() =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        body: null,
        type: 'basic',
        text: () => Promise.resolve(smallText),
      } as unknown as Response)) as typeof fetch

    const transport = createFetchTransport({ fetchImpl })
    const outcome = await transport.send(REQ)
    if (outcome.kind !== 'response') throw new Error(outcome.kind)
    expect(outcome.bodyText).toBe(smallText)
  })

  it('fallback เมื่อ response.body เป็น null และข้อความยาวเกิน cap ก็ยัง reject เป็น body_too_large', async () => {
    const longText = 'x'.repeat(200)
    const fetchImpl = (() =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        body: null,
        type: 'basic',
        text: () => Promise.resolve(longText),
      } as unknown as Response)) as typeof fetch

    const transport = createFetchTransport({ fetchImpl, maxBodyBytes: 100 })
    const outcome = await transport.send(REQ)
    expect(outcome).toEqual({ kind: 'body_too_large' })
  })
})
