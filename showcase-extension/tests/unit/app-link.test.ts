import { describe, expect, it } from 'vitest'
import { APP_HEALTH_URL, checkAppConnection, relativeDaysThai, type AppLinkDeps } from '../../extension/src/dashboard/app-link.js'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const deps = (over: Partial<AppLinkDeps>): AppLinkDeps => ({
  hasPermission: () => Promise.resolve(true),
  getSecret: () => Promise.resolve('s3cret'),
  fetchImpl: () => Promise.resolve(jsonResponse({ ok: true, secretOk: true, productCount: 197, lastImportAt: '2026-09-24T11:25:19.626Z' })),
  ...over,
})

describe('checkAppConnection — ไฟสถานะของ popup', () => {
  it('ยังไม่ให้สิทธิ์ localhost → no_permission และไม่ยิง network เลย', async () => {
    let fetched = false
    const result = await checkAppConnection(
      deps({
        hasPermission: () => Promise.resolve(false),
        fetchImpl: () => {
          fetched = true
          return Promise.resolve(jsonResponse({}))
        },
      }),
    )
    expect(result).toEqual({ kind: 'no_permission' })
    expect(fetched).toBe(false)
  })

  it('ยังไม่บันทึกรหัส → no_secret', async () => {
    expect(await checkAppConnection(deps({ getSecret: () => Promise.resolve('') }))).toEqual({ kind: 'no_secret' })
  })

  it('แอปไม่ตอบ (fetch โยน) → offline', async () => {
    const result = await checkAppConnection(deps({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) }))
    expect(result).toEqual({ kind: 'offline' })
  })

  it('แอปตอบ non-2xx → offline', async () => {
    expect(await checkAppConnection(deps({ fetchImpl: () => Promise.resolve(jsonResponse({}, 500)) }))).toEqual({
      kind: 'offline',
    })
  })

  it('รหัสไม่ตรง → bad_secret', async () => {
    const result = await checkAppConnection(
      deps({ fetchImpl: () => Promise.resolve(jsonResponse({ ok: true, secretOk: false })) }),
    )
    expect(result).toEqual({ kind: 'bad_secret' })
  })

  it('พร้อม → ready พร้อมจำนวนสินค้าและเวลานำเข้าล่าสุด และส่งรหัสไปกับ health', async () => {
    let sentUrl = ''
    let sentSecret: string | null = null
    const result = await checkAppConnection(
      deps({
        fetchImpl: (input, init) => {
          sentUrl = String(input)
          sentSecret = new Headers(init?.headers).get('x-showcase-secret')
          return Promise.resolve(
            jsonResponse({ ok: true, secretOk: true, productCount: 197, lastImportAt: '2026-09-24T11:25:19.626Z' }),
          )
        },
      }),
    )
    expect(result).toEqual({ kind: 'ready', productCount: 197, lastImportAt: '2026-09-24T11:25:19.626Z' })
    expect(sentUrl).toBe(APP_HEALTH_URL)
    expect(sentSecret).toBe('s3cret')
  })

  it('แอปรุ่นเก่าที่ health ไม่มี secretOk → ถือว่ารหัสยังยืนยันไม่ได้ (bad_secret) ไม่ใช่ ready', async () => {
    const result = await checkAppConnection(deps({ fetchImpl: () => Promise.resolve(jsonResponse({ ok: true })) }))
    expect(result).toEqual({ kind: 'bad_secret' })
  })
})

describe('relativeDaysThai', () => {
  const now = Date.parse('2026-09-29T05:00:00Z')
  it('ภายใน 24 ชม. → วันนี้', () => expect(relativeDaysThai('2026-09-29T01:00:00Z', now)).toBe('วันนี้'))
  it('1 วัน → เมื่อวาน', () => expect(relativeDaysThai('2026-09-28T04:00:00Z', now)).toBe('เมื่อวาน'))
  it('5 วัน', () => expect(relativeDaysThai('2026-09-24T04:00:00Z', now)).toBe('5 วันก่อน'))
  it('วันที่อ่านไม่ได้', () => expect(relativeDaysThai('ไม่ใช่วันที่', now)).toBe('ไม่ทราบ'))
})
