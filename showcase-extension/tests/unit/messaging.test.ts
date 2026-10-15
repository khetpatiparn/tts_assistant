import { describe, it, expect } from 'vitest'
import { validateMessage } from '../../extension/src/messaging/validate.js'
import { handleMessage } from '../../extension/src/messaging/handle.js'
import { createMockShowcaseAdapter } from '../../extension/src/adapters/mock-showcase.js'

const SELF = 'abcdefghijklmnopabcdefghijklmnop'
const sender = { id: SELF, url: `chrome-extension://${SELF}/dashboard/index.html` }

describe('message validation (R02/R11)', () => {
  it('รับ message ที่อยู่ใน allowlist', () => {
    expect(validateMessage({ type: 'app.info' }, sender, SELF)).toEqual({ type: 'app.info' })
  })

  it('ปฏิเสธ type ที่ไม่รู้จัก', () => {
    expect(() => validateMessage({ type: 'showcase.fetch' }, sender, SELF)).toThrow(/msg_unknown_type/)
  })

  it('ปฏิเสธ message ที่พก URL/endpoint/headers มาด้วย — กัน arbitrary fetch (§7.1)', () => {
    for (const field of ['url', 'endpoint', 'path', 'headers', 'method', 'origin']) {
      expect(() => validateMessage({ type: 'app.info', [field]: 'x' }, sender, SELF)).toThrow(
        /msg_forbidden_field/,
      )
    }
  })

  it('ปฏิเสธ key แปลกปลอมทุกตัว — key-set equality ไม่ใช่ denylist', () => {
    expect(() => validateMessage({ type: 'app.info', extra: 1 }, sender, SELF)).toThrow(
      /msg_forbidden_field/,
    )
  })

  it('ปฏิเสธ payload ที่ไม่ใช่ plain object', () => {
    for (const bad of [null, undefined, 'app.info', 42, ['app.info']]) {
      expect(() => validateMessage(bad, sender, SELF)).toThrow(/msg_malformed/)
    }
  })

  it('ปฏิเสธ sender ที่ไม่ใช่ extension ตัวเอง', () => {
    expect(() =>
      validateMessage({ type: 'app.info' }, { id: 'someoneelse', url: 'https://evil.test/' }, SELF),
    ).toThrow(/msg_forbidden_sender/)
  })

  it('ปฏิเสธ sender ที่ id ตรงแต่ url มาจากหน้าเว็บ', () => {
    expect(() =>
      validateMessage({ type: 'app.info' }, { id: SELF, url: 'https://evil.test/page' }, SELF),
    ).toThrow(/msg_forbidden_sender/)
  })

  it('data.clear ผ่าน validator และไม่รับ key แปลกปลอม', () => {
    expect(validateMessage({ type: 'data.clear' }, sender, SELF)).toEqual({ type: 'data.clear' })
    expect(() => validateMessage({ type: 'data.clear', url: 'x' }, sender, SELF)).toThrow(
      /msg_forbidden_field/,
    )
  })

  it('adapter.probe บังคับให้ offset/count เป็น non-negative safe integer', () => {
    expect(validateMessage({ type: 'adapter.probe', offset: 0, count: 6 }, sender, SELF)).toEqual({
      type: 'adapter.probe',
      offset: 0,
      count: 6,
    })
    for (const bad of [{ offset: -1, count: 6 }, { offset: 0, count: 1.5 }, { offset: 0, count: '6' }]) {
      expect(() => validateMessage({ type: 'adapter.probe', ...bad }, sender, SELF)).toThrow(
        /msg_malformed/,
      )
    }
  })
})

describe('message handling', () => {
  const ctx = { adapter: createMockShowcaseAdapter() }

  it('app.info คืนเวอร์ชันและโหมด adapter', async () => {
    const r = await handleMessage({ type: 'app.info' }, ctx)
    expect(r).toMatchObject({ ok: true, schemaVersion: 1, adapterMode: 'mock', g0Verified: false })
  })

  it('status.get คืน state จาก vocabulary ของ §10', async () => {
    const r = await handleMessage({ type: 'status.get' }, ctx)
    expect(r).toMatchObject({ ok: true, state: 'idle', runId: null, sourceIdentityVerified: false })
  })
})

/**
 * adapter.probe (§14.1) — "ทดลองหนึ่งหน้าก่อน" ไม่ใช่ full scan: หนึ่ง request เดียว ไม่มี
 * pagination ไม่มี retry อัตโนมัติ ไม่ใช้ lease/registry เลย พิสูจน์ด้วย ProbeContext ที่มีแค่
 * sourceRef/now — เข้าถึง store/registry/sleep ไม่ได้จริงตาม type ไม่ใช่แค่คอมเมนต์
 */
describe('adapter.probe — ผลทดสอบหนึ่งหน้า (§14.1)', () => {
  const probeCtx = {
    adapter: createMockShowcaseAdapter(),
    sourceRef: 'local-profile-01',
    probeRegistry: { inFlight: false },
    now: () => Date.parse('2026-09-20T10:00:00Z'),
  }

  it('เดินผ่าน mock adapter ได้โดยไม่แตะ network และคืน resultKind ที่แยกจาก full scan ชัดเจน', async () => {
    const r = await handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, probeCtx)
    expect(r).toMatchObject({ ok: true, resultKind: 'single_page_probe', httpStatus: 200, outcome: 'ok' })
    expect((r as unknown as { byteLength: number }).byteLength).toBeGreaterThan(0)
  })

  it('คืนรายการ normalized products จริง พร้อม counters ของหน้านั้น (ไม่ใช่ของทั้ง run)', async () => {
    const r = await handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, probeCtx)
    if (!('resultKind' in r) || r.resultKind !== 'single_page_probe') {
      throw new Error('unexpected response')
    }
    expect(r.products.length).toBeGreaterThan(0)
    expect(r.products[0]).toMatchObject({ schemaVersion: 1, sourceRef: 'local-profile-01' })
    expect(r.counters).toEqual({
      receivedRows: r.products.length,
      validRows: r.products.length,
      invalidRows: 0,
    })
  })

  it('ไม่ต้องมี store/registry/sleep เลย — พิสูจน์ว่าไม่ใช้ lease/retry machinery ของ run.*', async () => {
    // ctx ไม่มี store/registry/sleep แม้แต่ field เดียว ต่างจาก run.* ทุกตัวที่ throw
    // run_context_unavailable ถ้าขาด แต่ adapter.probe ทำงานได้ปกติ
    const r = await handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, probeCtx)
    expect(r.ok).toBe(true)
  })

  it('ขาด sourceRef/now ถูกปฏิเสธด้วย run_context_unavailable — ไม่ normalize แบบไม่มี context', async () => {
    // handleMessage เอง throw ตรง ๆ (เหมือน run.* ทุกตัว) — background.ts เป็นชั้นที่แปลงเป็น
    // {ok:false, code} ให้ ที่นี่ทดสอบแค่ระดับ handleMessage ตรง ๆ
    await expect(
      handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, { adapter: createMockShowcaseAdapter() }),
    ).rejects.toMatchObject({ code: 'run_context_unavailable' })
  })

  it('401/403/429/challenge หยุดทันที ไม่ normalize ไม่ retry — outcome บอกเหตุผลตรง ๆ', async () => {
    const cases: readonly [number, Record<string, string>, string][] = [
      [401, { 'content-type': 'application/json' }, 'auth_required'],
      [403, { 'content-type': 'application/json' }, 'access_denied'],
      [429, { 'content-type': 'application/json' }, 'rate_limited'],
    ]
    for (const [httpStatus, headers, expectedOutcome] of cases) {
      const adapter = {
        adapterVersion: 'mock-v0' as const,
        mode: 'mock' as const,
        fetchPage: () => Promise.resolve({ httpStatus, headers, bodyText: '{}' }),
      }
      const r = await handleMessage(
        { type: 'adapter.probe', offset: 0, count: 6 },
        { ...probeCtx, adapter },
      )
      expect(r, String(httpStatus)).toMatchObject({
        ok: true,
        resultKind: 'single_page_probe',
        outcome: expectedOutcome,
        products: [],
        counters: null,
      })
    }
  })

  it('challenge (HTML แทน JSON) หยุดด้วย outcome=challenge_required ไม่ใช่ schema_changed เหมารวม', async () => {
    const adapter = {
      adapterVersion: 'mock-v0' as const,
      mode: 'mock' as const,
      fetchPage: () =>
        Promise.resolve({
          httpStatus: 200,
          headers: { 'content-type': 'text/html' },
          bodyText: '<html>please log in</html>',
        }),
    }
    const r = await handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, { ...probeCtx, adapter })
    expect(r).toMatchObject({
      ok: true,
      resultKind: 'single_page_probe',
      outcome: 'challenge_required',
      products: [],
      counters: null,
    })
  })

  it('ไม่ retry แม้เจอ error ที่ปกติ retry ได้ (เช่น 500) — probe ยิงแค่ครั้งเดียวเสมอ', async () => {
    let calls = 0
    const adapter = {
      adapterVersion: 'mock-v0' as const,
      mode: 'mock' as const,
      fetchPage: () => {
        calls += 1
        return Promise.resolve({ httpStatus: 500, headers: {}, bodyText: '{}' })
      },
    }
    const r = await handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, { ...probeCtx, adapter })
    expect(r).toMatchObject({ ok: true, outcome: 'server_error', products: [] })
    expect(calls).toBe(1)
  })

  it('กดซ้อนขณะ request เดิมยังทำงาน ถูกปฏิเสธด้วย probe_in_flight และยิงแค่ครั้งเดียว', async () => {
    let calls = 0
    const page = {
      httpStatus: 200,
      headers: { 'content-type': 'application/json' },
      bodyText: '{"code":0,"message":"success","data":{"products":[],"total":0}}',
    }
    // executor ของ Promise ทำงานแบบ synchronous — release ถูกกำหนดค่าแน่นอนก่อนถูกเรียกใช้
    let release!: () => void
    const pending = new Promise<typeof page>((resolve) => {
      release = () => {
        resolve(page)
      }
    })
    const slowAdapter = {
      adapterVersion: 'mock-v0' as const,
      mode: 'mock' as const,
      fetchPage: () => {
        calls += 1
        return pending
      },
    }
    const ctx = { ...probeCtx, adapter: slowAdapter, probeRegistry: { inFlight: false } }

    const first = handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, ctx)
    // ครั้งที่สองมาถึงขณะครั้งแรกยังค้างอยู่ — ต้องถูกปฏิเสธ ไม่ใช่ยิงซ้อน
    const second = await handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, ctx)
    expect(second).toEqual({ ok: false, code: 'probe_in_flight' })
    expect(calls).toBe(1)

    release()
    await first
    // ปลดธงแล้ว — กดใหม่ได้ตามปกติ ไม่ค้างถาวร
    expect(ctx.probeRegistry.inFlight).toBe(false)
  })

  it('ธงกันกดซ้อนถูกปลดแม้ adapter จะ throw — ปุ่มไม่ค้างกดไม่ได้ตลอดไป', async () => {
    const registry = { inFlight: false }
    const throwing = {
      adapterVersion: 'live-v1' as const,
      mode: 'live' as const,
      fetchPage: () => Promise.reject(new Error('adapter_network_error')),
    }
    await expect(
      handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, { ...probeCtx, adapter: throwing, probeRegistry: registry }),
    ).rejects.toThrow()
    expect(registry.inFlight).toBe(false)
  })

  it('message ที่ไม่ใช่ probe ไม่เคยเรียก fetchPage เลย — ไม่มี request ก่อนผู้ใช้กด', async () => {
    let calls = 0
    const spyAdapter = {
      adapterVersion: 'live-v1' as const,
      mode: 'live' as const,
      fetchPage: () => {
        calls += 1
        return Promise.reject(new Error('should not be called'))
      },
    }
    const ctx = { ...probeCtx, adapter: spyAdapter }
    await handleMessage({ type: 'app.info' }, ctx)
    await handleMessage({ type: 'status.get' }, ctx)
    expect(calls).toBe(0)
  })

  it('adapter ที่ throw (เช่น permission_required) ไม่ถูกกลืน — หลุดขึ้นไปให้ background.ts จับ', async () => {
    const adapter = {
      adapterVersion: 'live-v1' as const,
      mode: 'live' as const,
      fetchPage: () => Promise.reject(new Error('permission_required')),
    }
    await expect(
      handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, { ...probeCtx, adapter }),
    ).rejects.toThrow('permission_required')
  })

  it('response ไม่มี header, cookie, token หรือ body ดิบหลุดออกมา (R11) ทั้งกรณี ok และกรณีหยุด', async () => {
    const okResult = await handleMessage({ type: 'adapter.probe', offset: 0, count: 6 }, probeCtx)
    const blockedAdapter = {
      adapterVersion: 'mock-v0' as const,
      mode: 'mock' as const,
      fetchPage: () => Promise.resolve({ httpStatus: 401, headers: { 'set-cookie': 'x' }, bodyText: '{}' }),
    }
    const blockedResult = await handleMessage(
      { type: 'adapter.probe', offset: 0, count: 6 },
      { ...probeCtx, adapter: blockedAdapter },
    )
    for (const result of [okResult, blockedResult]) {
      const raw = JSON.stringify(result).toLowerCase()
      for (const leak of ['cookie', 'authorization', 'set-cookie', 'bodytext', 'token', 'content-type']) {
        expect(raw, JSON.stringify(result)).not.toContain(leak)
      }
    }
  })
})
