import type { ShowcaseAdapter } from '../adapters/types.js'
import { resumeDashboardState } from '../dashboard/resume.js'
import type { ResumeState } from '../dashboard/resume.js'
import { validateEnvelope } from '../domain/envelope.js'
import { FlowAError } from '../domain/errors.js'
import { validatePage } from '../domain/page.js'
import { G0_VERIFIED, SCHEMA_VERSION } from '../domain/version.js'
import { buildExport } from '../export/json.js'
import { runImport } from '../core/runner.js'
import type { RunReport } from '../core/runner.js'
import type { CheckpointStore } from '../storage/checkpoints.js'
import type { FlowAMessage, FlowAResponse } from './schema.js'

/** §9.4 default budget ใช้ค่ามาตรฐานจาก runner; page size คงที่ตาม fixture ของ mock ใน M1 */
export const DEFAULT_RUN_PAGE_SIZE = 6

/**
 * สถานะ run ปัจจุบันที่ background เก็บไว้ในหน่วยความจำ — หายได้ถ้า service worker ถูกหยุด
 * ข้อมูลที่ทนความจริง (staged products/checkpoint) อยู่ใน IndexedDB เสมอ (spec §10);
 * registry นี้จึงเป็นแค่ทางลัดให้ UI เห็น progress สด ๆ ไม่ใช่แหล่งความจริง
 */
export interface RunRegistry {
  currentController: AbortController | null
  currentReport: RunReport | null
}

/**
 * กันกดซ้อนของ adapter.probe — หนึ่ง request ต่อหนึ่ง service worker ณ เวลาหนึ่ง
 * แยกจาก RunRegistry โดยตั้งใจ: probe ไม่มี lease, ไม่มี checkpoint, ไม่มี retry ให้ต้องจัดการ
 * มีแค่ธงเดียวว่า "กำลังยิงอยู่ไหม" เพื่อไม่ให้สองแท็บ (หรือดับเบิลคลิก) ยิงซ้อนกัน
 */
export interface ProbeRegistry {
  inFlight: boolean
}

export interface HandlerContext {
  readonly adapter: ShowcaseAdapter
  readonly store?: CheckpointStore
  readonly sourceRef?: string
  readonly registry?: RunRegistry
  readonly probeRegistry?: ProbeRegistry
  now?(): number
  sleep?(ms: number, signal: AbortSignal): Promise<void>
}

interface RunContext {
  readonly store: CheckpointStore
  readonly sourceRef: string
  readonly registry: RunRegistry
  now(): number
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

interface ProbeContext {
  readonly sourceRef: string
  readonly probeRegistry: ProbeRegistry
  now(): number
}

/**
 * probe ต้องการแค่ sourceRef/now (สำหรับ normalize) + ธงกันกดซ้อน — **ไม่ต้องมี store/sleep
 * หรือ RunRegistry** เพราะ probe ไม่ผ่าน lease หรือ retry machinery ใด ๆ เลย ต่างจาก
 * requireRunContext ของ run.* (พิสูจน์ด้วยชนิดข้อมูล ไม่ใช่แค่คอมเมนต์ — โค้ดจุดนี้เข้าถึง
 * store/sleep/currentController ไม่ได้จริง ๆ)
 */
const requireProbeContext = (ctx: HandlerContext): ProbeContext => {
  if (ctx.sourceRef === undefined || ctx.now === undefined || ctx.probeRegistry === undefined) {
    throw new FlowAError('run_context_unavailable')
  }
  return { sourceRef: ctx.sourceRef, probeRegistry: ctx.probeRegistry, now: ctx.now }
}

const requireRunContext = (ctx: HandlerContext): RunContext => {
  if (
    ctx.store === undefined ||
    ctx.sourceRef === undefined ||
    ctx.registry === undefined ||
    ctx.now === undefined ||
    ctx.sleep === undefined
  ) {
    throw new FlowAError('run_context_unavailable')
  }
  return {
    store: ctx.store,
    sourceRef: ctx.sourceRef,
    registry: ctx.registry,
    now: ctx.now,
    sleep: ctx.sleep,
  }
}

export async function handleMessage(
  message: FlowAMessage,
  ctx: HandlerContext,
): Promise<FlowAResponse> {
  switch (message.type) {
    case 'app.info':
      return {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        adapterMode: ctx.adapter.mode,
        adapterVersion: ctx.adapter.adapterVersion,
        g0Verified: G0_VERIFIED,
      }

    case 'status.get':
      return {
        ok: true,
        state: 'idle',
        runId: null,
        sourceRef: null,
        sourceIdentityVerified: false,
      }

    case 'adapter.probe': {
      const probeCtx = requireProbeContext(ctx)

      // กันกดซ้อน — ตรวจแล้วจองธงแบบ synchronous ห้ามมี await คั่นระหว่างกลาง (เหตุผลเดียวกับ
      // TOCTOU ของ run.start) มิฉะนั้นสองคลิก/สองแท็บที่มาพร้อมกันจะลอดผ่านไปได้ทั้งคู่
      if (probeCtx.probeRegistry.inFlight) return { ok: false, code: 'probe_in_flight' }
      probeCtx.probeRegistry.inFlight = true

      try {
        // §14.1 — หนึ่ง request เดียว ไม่มี pagination ไม่มี retry อัตโนมัติ ไม่มี lease
        // (ต่างจาก run.start ที่ผ่าน runImport) ถ้า adapter throw (เช่น permission_required,
        // g0_not_verified, adapter_network_error) ปล่อยให้หลุดขึ้นไปให้ผู้เรียก catch เอง —
        // ไม่ retry ที่นี่เด็ดขาด
        const page = await ctx.adapter.fetchPage(
          { offset: message.offset, count: message.count },
          new AbortController().signal,
        )

        // §9.2 ข้อ 5 — ตรวจ HTTP status/content-type/envelope ก่อนแตะ products เสมอ
        // แยก 401/403/429/challenge/schema ออกจาก "ไม่มีสินค้า" ให้ชัด ไม่ normalize ต่อถ้าไม่ผ่าน
        const envelope = validateEnvelope(page)
        if (envelope.outcome !== 'ok') {
          return {
            ok: true,
            resultKind: 'single_page_probe',
            httpStatus: page.httpStatus,
            byteLength: page.bodyText.length,
            adapterMode: ctx.adapter.mode,
            adapterVersion: ctx.adapter.adapterVersion,
            sourceRef: probeCtx.sourceRef,
            outcome: envelope.outcome,
            products: [],
            counters: null,
          }
        }

        const validated = validatePage(page, {
          sourceRef: probeCtx.sourceRef,
          sourceIdentityVerified: false,
          observedAt: new Date(probeCtx.now()).toISOString(),
        })
        // validateEnvelope ผ่านแล้วแปลว่า validatePage ต้องผ่านด้วยเสมอ (เส้นทางเดียวกัน,
        // pure function ของ page เดิม) — เผื่อไว้ด้วย early return ที่ปลอดภัยแทนการสมมติแบบไม่มีเงื่อนไข
        // ใช้ outcome จริงที่ validatePage รายงาน ไม่เดา/ไม่ hardcode
        if (validated.outcome !== 'ok') {
          return {
            ok: true,
            resultKind: 'single_page_probe',
            httpStatus: page.httpStatus,
            byteLength: page.bodyText.length,
            adapterMode: ctx.adapter.mode,
            adapterVersion: ctx.adapter.adapterVersion,
            sourceRef: probeCtx.sourceRef,
            outcome: validated.outcome,
            products: [],
            counters: null,
          }
        }

        // คืนรายการ normalized (schema เดียวกับ run.export — พิสูจน์แล้วว่าไม่มี raw body/headers/
        // cookie หลุดออกมา) พร้อมป้าย resultKind ชัดเจนว่าเป็นผลทดสอบหนึ่งหน้า ไม่ใช่ผลสแกนครบ (R11)
        return {
          ok: true,
          resultKind: 'single_page_probe',
          httpStatus: page.httpStatus,
          byteLength: page.bodyText.length,
          adapterMode: ctx.adapter.mode,
          adapterVersion: ctx.adapter.adapterVersion,
          sourceRef: probeCtx.sourceRef,
          outcome: 'ok',
          products: validated.products,
          counters: {
            receivedRows: validated.counters.receivedRows,
            validRows: validated.counters.validRows,
            invalidRows: validated.counters.invalidRows,
          },
        }
      } finally {
        // ปลดธงเสมอ แม้ adapter จะ throw — ไม่งั้นปุ่มจะค้างกดไม่ได้ตลอดไปจนกว่า SW จะถูกรีสตาร์ต
        probeCtx.probeRegistry.inFlight = false
      }
    }

    case 'run.start': {
      const run = requireRunContext(ctx)
      // §2.2/R03 — หนึ่งงานต่อ profile ระดับ UX; lease ใน checkpoint store เป็นตัวบังคับจริง
      if (run.registry.currentController !== null) {
        return { ok: false, code: 'already_running' }
      }

      // จอง slot แบบ synchronous ทันทีหลัง guard ด้านบน — ห้ามมี await คั่นระหว่างกลางเด็ดขาด
      // (Fix round 1 — D3 regression) รุ่นแรกของ fix นี้แทรก `await findActiveRunWithCount` ไว้
      // ตรงนี้ก่อน claim ทำให้เปิดช่อง TOCTOU race: run.start ตัวที่สองที่ถูก dispatch มาพร้อมกัน
      // (สองแท็บ/double-click) เห็น currentController เป็น null เหมือนกันระหว่างที่ตัวแรกยัง await
      // อยู่ แล้วลอดผ่าน guard ไปด้วยทั้งคู่ ทำลาย LC01 — ต้อง claim ให้เสร็จก่อนมี await ใด ๆ เท่านั้น
      const controller = new AbortController()
      run.registry.currentController = controller
      run.registry.currentReport = null

      // fire-and-forget โดยตั้งใจ: runImport อาจกินเวลานาน ไม่ block message channel
      // ผลลัพธ์ถูก poll ผ่าน run.status; ข้อมูลจริงถูก persist ทีละหน้าใน IndexedDB อยู่แล้ว
      void (async () => {
        // ถึงตรงนี้แปลว่า service worker ตัวนี้จอง slot ไว้แล้ว (claim ด้านบนกันไม่ให้ run.start
        // ตัวอื่นมาแทรกได้) ถ้ายังมี lease ค้างอยู่ใน checkpoint ของ sourceRef นี้ แปลว่าเป็นของ
        // worker ที่ถูกฆ่าไปแล้ว ปล่อยทิ้งก่อนที่ runImport จะเรียก acquireLease ของตัวเอง มิฉะนั้น
        // จะชน lease เก่าแล้วได้ run_already_active ทั้งที่ไม่มีใครแย่งจริง (LC06 — เสนอ scan ใหม่จาก 0)
        // หมายเหตุ (Task 3 fix round 1): findActiveRun ถูกลบแล้วเพราะกลายเป็น dead code หลัง resume.ts
        // เปลี่ยนไปใช้ findActiveRunWithCount — ใช้ตัวนั้นแทน ดึงแค่ .checkpoint
        const orphan = (await run.store.findActiveRunWithCount(run.sourceRef))?.checkpoint ?? null
        if (orphan !== null) await run.store.releaseLease(orphan.runId, orphan.generation)

        // D5 — ล้างผลของ run ก่อนหน้าออกจาก IndexedDB ก่อนเริ่มวิ่งจริง กัน export ระหว่างที่ run นี้
        // ยังไม่จบ (ถ้า service worker ถูกฆ่ากลางทาง) ไปหยิบผลของ run เก่าที่จบไปแล้วมาให้แทน
        // (ทำในนี้ ไม่ใช่ใน synchronous claim block ด้านบน เพื่อไม่ทำลาย TOCTOU guard ของมัน)
        await run.store.clearFinishedReport(run.sourceRef)

        const report = await runImport(
          {
            runId: crypto.randomUUID(),
            sourceRef: run.sourceRef,
            pageSize: DEFAULT_RUN_PAGE_SIZE,
            signal: controller.signal,
            maxPages: message.maxPages,
          },
          { adapter: ctx.adapter, store: run.store, now: run.now, sleep: run.sleep },
        )
        // D5 — persist ก่อนตั้งค่าใน memory เสมอ ไม่ใช่ลำดับกลับกัน: ถ้า service worker ถูกฆ่า
        // ระหว่างสองบรรทัดนี้ ต้องไม่มีช่วงเวลาที่ currentReport มีค่าใน memory แต่ยังไม่ถูก
        // persist ลง store — มิฉะนั้นผลลัพธ์ของ run ที่เพิ่งจบจะหายไปเงียบ ๆ พอ worker ตาย
        await run.store.saveFinishedReport(run.sourceRef, report)
        run.registry.currentReport = report
        run.registry.currentController = null
      })().catch(() => {
        // ไม่มี .catch() ตรงนี้มาก่อน = unhandled rejection ที่ JS กลืนเงียบ ๆ ถ้า findActiveRunWithCount/
        // releaseLease/runImport โยนจริง (เช่น IndexedDB ล้มเหลว) currentController จะไม่ถูกรีเซ็ตเป็น null
        // เลย ค้างตลอดไป — ทั้ง run.start ใหม่ (guard ด้านบน) และ data.clear (ตั้งแต่ Task 6, guard เดียวกัน)
        // จะถูกปฏิเสธไปตลอดกาลโดยไม่มีทางกู้คืนได้จาก UI เลย จึงต้อง reset ให้ผู้ใช้ลองใหม่ได้เสมอ
        run.registry.currentController = null
      })

      return { ok: true, started: true }
    }

    case 'run.cancel': {
      const run = requireRunContext(ctx)
      run.registry.currentController?.abort()
      return { ok: true }
    }

    case 'run.status': {
      const run = requireRunContext(ctx)
      if (run.registry.currentController !== null) {
        const resume = await resumeDashboardState(run.store, run.sourceRef, run.now())
        return { ok: true, phase: 'running', resume, report: null }
      }
      // D5 — registry เป็นแค่ทางลัดในหน่วยความจำ (หายได้ถ้า service worker ถูกฆ่า) ต้อง fallback
      // ไปอ่านผลที่ persist ไว้ใน IndexedDB เสมอเมื่อ memory ว่าง มิฉะนั้นผู้ใช้ที่สแกนเสร็จแล้ว
      // เผลอปล่อยให้ dashboard ค้างอยู่นานเกิน idle timeout ของ service worker (หรือแค่ reload หน้า)
      // จะเห็น "พร้อมเริ่มสแกนใหม่" ทั้งที่ผลลัพธ์ยังอยู่ครบ
      const report = run.registry.currentReport ?? (await run.store.readFinishedReport(run.sourceRef))
      if (report !== null) {
        return { ok: true, phase: 'finished', resume: null, report }
      }
      const resume = await resumeDashboardState(run.store, run.sourceRef, run.now())
      // registry ว่างแต่ lease ยังมีชีวิต = service worker เจ้าของถูกฆ่า (MV3 มี worker เดียวต่อ extension)
      // รายงานตามความจริงว่า interrupted ไม่ใช่ปล่อยให้ UI เข้าใจว่าไม่มีอะไรค้างอยู่
      const corrected: ResumeState =
        resume.kind === 'running'
          ? { kind: 'interrupted', checkpoint: resume.checkpoint, productCount: resume.productCount }
          : resume
      return { ok: true, phase: 'idle', resume: corrected, report: null }
    }

    case 'run.export': {
      const run = requireRunContext(ctx)
      // D5 — ถ้ามี run ค้างอยู่จริงใน IndexedDB (กำลังวิ่ง หรือ interrupted แต่ยังไม่ release lease)
      // ต้องปฏิเสธก่อนเสมอ ไม่ใช่ไปหยิบผลของ run ก่อนหน้าที่จบไปแล้วมาให้แทนอย่างเงียบ ๆ —
      // runImport() release lease ในทุกเส้นทางจบงานเสมอ (try/finally) ดังนั้นเงื่อนไขนี้เป็นจริง
      // ก็ต่อเมื่อมี run ที่ยังไม่จบค้างอยู่จริงเท่านั้น ไม่ใช่ false positive จาก run ที่จบไปแล้ว
      if (run.registry.currentController !== null || (await run.store.findActiveRunWithCount(run.sourceRef)) !== null) {
        return { ok: false, code: 'run_active' }
      }
      const report = run.registry.currentReport ?? (await run.store.readFinishedReport(run.sourceRef))
      if (report === null) return { ok: false, code: 'no_report' }
      const payload = buildExport(report, message.selectedIds, run.now)
      return { ok: true, payload }
    }

    case 'data.clear': {
      const run = requireRunContext(ctx)
      // ปฏิเสธเฉพาะเมื่อ worker นี้มี run วิ่งอยู่จริง (เงื่อนไขเดียวกับ guard ของ run.start ข้างบน) —
      // ถ้าล้างตอนนั้น แถวจะถูก commit กลับเข้ามาใหม่ ส่วน lease ที่กำพร้าเป็นของ worker ที่ตายแล้ว
      // ไม่มีอะไรเขียนกลับได้ จึงล้างได้อย่างปลอดภัย
      if (run.registry.currentController !== null) {
        return { ok: false, code: 'run_active' }
      }
      await run.store.clearAll()
      run.registry.currentReport = null
      return { ok: true, cleared: true }
    }
  }
}
