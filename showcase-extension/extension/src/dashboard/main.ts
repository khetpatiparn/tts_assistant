import type { QuarantinedRecord, RunReport } from '../core/runner.js'
import type { NormalizedProduct } from '../domain/product.js'
import { buildProbeExport } from '../export/json.js'
import type { ScannerMessage, ScannerMessageType, ResponseMap } from '../messaging/schema.js'
import {
  clearDeliveryMemory,
  consumeAutoScanRequest,
  deliver,
  getDestinationLink,
  parseDestinationLink,
  pickNewProductIds,
  resolveKnownIds,
  saveDestinationLink,
} from './destination.js'
import { appendLabeledRow, clearChildren, setText } from './dom.js'
import { DEFAULT_PAGE_SIZE, renderPreviewPage, totalPages } from './preview.js'
import type { SelectableFilter } from './selection.js'
import {
  countSelectedInFilter,
  deselectAllInFilter,
  productsInFilter,
  selectAllInFilter,
  toggleSelection,
} from './selection.js'

declare const __ADAPTER_MODE__: 'mock' | 'live'
declare const __BUILD_HASH__: string

/** §16 — progress ต้องแสดงภายใน 1 วินาทีหลัง commit; คาบ poll ต้องต่ำกว่างบอย่างมีระยะเผื่อ */
const POLL_INTERVAL_MS = 250

const send = <T extends ScannerMessageType>(
  message: Extract<ScannerMessage, { type: T }>,
): Promise<ResponseMap[T]> => chrome.runtime.sendMessage(message) as Promise<ResponseMap[T]>

const requireElement = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`missing element: ${id}`)
  return el
}

// ---------- banner ตามช่องทาง build ----------
//
// HTML มีข้อความของ mock channel เป็นค่าเริ่มต้น (E2E ตรวจคำว่า MOCK-ONLY อยู่) — live build ซ่อนป้าย
// ทิ้ง: ข้อความ "LIVE TRIAL BUILD … full scan ยังปิดอยู่" เดิมมาจากช่วงก่อนเปิด full scan และไม่จริงแล้ว
// (full scan + ส่งไปปลายทางใช้งานจริงตั้งแต่ 2026-09-24) ผู้ใช้เห็นแล้วงง (2026-09-29)
function renderChannelBanner(): void {
  if (__ADAPTER_MODE__ !== 'live') return
  requireElement('channel-banner').hidden = true
}

// ---------- ข้อมูล build ----------

async function renderBuildInfo(): Promise<void> {
  const target = requireElement('build-info')
  const info = await send({ type: 'app.info' })

  clearChildren(target)
  if (!info.ok) {
    setText(target, `อ่านข้อมูล build ไม่ได้: ${info.code}`)
    return
  }

  appendLabeledRow(target, 'adapter mode', info.adapterMode)
  appendLabeledRow(target, 'adapter version', info.adapterVersion)
  appendLabeledRow(target, 'schema version', String(info.schemaVersion))
  appendLabeledRow(target, 'G0 verified', info.g0Verified ? 'true' : 'false')
  appendLabeledRow(target, 'build channel', __ADAPTER_MODE__)
  appendLabeledRow(target, 'build hash', __BUILD_HASH__)
}

/** รายการ "ส่งแล้ว" สำหรับหยุดเอง — ปิดตัวเลือกไว้ = null (สแกนเต็ม) · ดู destination.ts resolveKnownIds */
async function resolveKnownProductIds(): Promise<readonly string[] | null> {
  const checkbox = requireElement('auto-stop-known-checkbox') as HTMLInputElement
  if (!checkbox.checked) return null
  return (await resolveKnownIds())?.ids ?? null
}

// ---------- ส่วนตั้งค่า (ลิงก์ปลายทาง) ----------
//
// สิทธิ์ shop.tiktok.com ได้ตอนติดตั้ง (host_permissions ใน manifest) และปลายทางเป็นลิงก์เดียวที่มี
// token อยู่ในตัว จึงไม่มีขั้นขอสิทธิ์/วาง secret แยกอีกแล้ว

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
  void clearDeliveryMemory().then(() =>
    setText(destinationStatusEl, 'ลืมรายการที่เคยส่งแล้ว — รอบหน้าจะส่งทุกตัวที่สแกนเจอ'),
  )
})

// ---------- ทดสอบอ่านหนึ่งหน้า (probe, §14.1) ----------

function renderProbeProducts(target: HTMLElement, products: readonly NormalizedProduct[]): void {
  if (products.length === 0) {
    appendLabeledRow(target, 'สินค้า', '(ไม่มี)')
    return
  }
  const list = target.ownerDocument.createElement('div')
  list.className = 'rows'
  for (const product of products) {
    appendLabeledRow(list, product.productId, product.title)
  }
  target.append(list)
}

const PROBE_COUNT = 6

const probeButton = requireElement('probe-button') as HTMLButtonElement
const probeNextButton = requireElement('probe-next-button') as HTMLButtonElement
const probeExportButton = requireElement('probe-export-button') as HTMLButtonElement

/** ผลของ probe ครั้งล่าสุดที่สำเร็จ — เก็บไว้ให้ปุ่ม export เท่านั้น ไม่ถูกใช้เริ่มอะไรเองเลย */
let lastProbe: {
  adapterVersion: string
  sourceRef: string
  products: readonly NormalizedProduct[]
} | null = null

/**
 * offset ของหน้าถัดไป ถ้ามี — `null` แปลว่ายังไม่รู้ว่ามีหน้าถัดไปหรือไม่ (ยังไม่เคยอ่าน หรือหน้าล่าสุด
 * ไม่เต็ม/ล้มเหลว) ค่านี้ถูกใช้ตอนกดปุ่มเท่านั้น ไม่มีตัวจับเวลาหรือการเรียกต่อเองใด ๆ อ่านจากค่านี้
 */
let nextProbeOffset: number | null = null

async function runProbe(offset: number): Promise<void> {
  const target = requireElement('probe-result')
  clearChildren(target)
  setText(target, `กำลังอ่าน offset=${String(offset)}…`)
  // กันกดซ้อนฝั่ง UI (service worker มีธงกันซ้อนของตัวเองอีกชั้นสำหรับกรณีหลายแท็บ)
  probeButton.disabled = true
  probeNextButton.disabled = true
  probeNextButton.hidden = true
  probeExportButton.hidden = true
  lastProbe = null
  nextProbeOffset = null

  let result: ResponseMap['adapter.probe']
  try {
    result = await send({ type: 'adapter.probe', offset, count: PROBE_COUNT })
  } finally {
    probeButton.disabled = false
    probeNextButton.disabled = false
  }

  clearChildren(target)
  if (!result.ok) {
    appendLabeledRow(target, 'ผลลัพธ์', `ล้มเหลว: ${result.code}`)
    return
  }

  // ป้ายกำกับให้ชัดว่านี่คือผลของหน้าเดียว ไม่ใช่ผลสแกนครบ (§14.1)
  appendLabeledRow(target, 'ประเภทผลลัพธ์', 'ผลทดสอบหนึ่งหน้า (ไม่ใช่ผลสแกนครบ)')
  appendLabeledRow(target, 'offset ที่อ่าน', `${String(offset)} (count=${String(PROBE_COUNT)})`)
  appendLabeledRow(target, 'adapter mode', result.adapterMode)
  appendLabeledRow(target, 'http status', String(result.httpStatus))
  appendLabeledRow(target, 'ขนาด body', `${String(result.byteLength)} ตัวอักษร`)
  appendLabeledRow(target, 'สถานะ envelope', result.outcome)

  if (result.outcome !== 'ok') {
    appendLabeledRow(target, 'ผลลัพธ์', `หยุด — ไม่ normalize ต่อ (เหตุผล: ${result.outcome})`)
    return
  }

  const receivedRows = result.counters?.receivedRows ?? 0
  appendLabeledRow(target, 'แถวที่ได้รับ', String(receivedRows))
  appendLabeledRow(target, 'แถวที่ใช้ได้', String(result.counters?.validRows ?? 0))
  appendLabeledRow(target, 'แถวที่ถูกปฏิเสธ', String(result.counters?.invalidRows ?? 0))
  renderProbeProducts(target, result.products)

  // หน้าเต็ม = อาจมีหน้าถัดไป · หน้าไม่เต็มหรือว่าง = ถึงปลายทางเท่าที่หน้านี้บอกได้
  // ไม่ใช้ `data.total` ตรงนี้เพราะ probe ตั้งใจให้เป็นการอ่านหน้าเดียวแบบไม่ตีความอะไรเกินตัว —
  // การสรุปปลายทางจาก total เป็นหน้าที่ของ runner (core/pagination.ts) ไม่ใช่ของปุ่มทดสอบ
  if (receivedRows >= PROBE_COUNT) {
    nextProbeOffset = offset + PROBE_COUNT
    setText(probeNextButton, `อ่านหน้าถัดไป (offset=${String(nextProbeOffset)})`)
    probeNextButton.hidden = false
  } else {
    appendLabeledRow(
      target,
      'หน้าถัดไป',
      'หน้านี้ไม่เต็ม — ไม่มีหน้าถัดไปให้อ่านด้วยปุ่มทดสอบ',
    )
  }

  // เปิดให้ export ตัวอย่างได้เฉพาะเมื่ออ่านสำเร็จจริง — ใช้ exporter เดิม (export/json.ts)
  // export ได้เฉพาะหน้าที่เพิ่งอ่าน ไม่สะสมข้ามหน้า เพราะการรวมหน้าเข้าด้วยกัน (dedupe/นับซ้ำ/
  // สรุปความครบ) เป็นงานของ runner ไม่ใช่ของปุ่มทดสอบ
  if (result.products.length > 0) {
    lastProbe = {
      adapterVersion: result.adapterVersion,
      sourceRef: result.sourceRef,
      products: result.products,
    }
    probeExportButton.hidden = false
  }
}

probeButton.addEventListener('click', () => {
  void runProbe(0)
})

probeNextButton.addEventListener('click', () => {
  const offset = nextProbeOffset
  if (offset === null) return
  void runProbe(offset)
})

probeExportButton.addEventListener('click', () => {
  const probe = lastProbe
  if (probe === null) return
  // exporter เดิม แต่ payload บอกตัวเองว่าเป็น single_page_probe + scanCoverage partial
  // จึงไม่มีทางถูกอ่านผิดว่าเป็นข้อมูลครบทั้ง Showcase
  const payload = buildProbeExport(probe, () => Date.now())
  downloadJson(`flow-a-probe-${payload.runId}.json`, payload)
})

// ---------- สแกน / preview / เลือก / export ----------

interface UiState {
  report: RunReport | null
  filter: SelectableFilter | 'rejected'
  selected: Set<string>
  page: number
  polling: boolean
}

const state: UiState = {
  report: null,
  filter: 'candidate',
  selected: new Set(),
  page: 0,
  polling: false,
}

const startButton = requireElement('start-button') as HTMLButtonElement
const cancelButton = requireElement('cancel-button') as HTMLButtonElement
const clearDataButton = requireElement('clear-data-button') as HTMLButtonElement
const runStatusEl = requireElement('run-status')
const previewSection = requireElement('preview-section')
const productList = requireElement('product-list')
const rejectedList = requireElement('rejected-list')
const selectAllButton = requireElement('select-all-button') as HTMLButtonElement
const deselectAllButton = requireElement('deselect-all-button') as HTMLButtonElement
const selectedCountEl = requireElement('selected-count')
const prevPageButton = requireElement('prev-page-button') as HTMLButtonElement
const nextPageButton = requireElement('next-page-button') as HTMLButtonElement
const pageIndicatorEl = requireElement('page-indicator')
const exportButton = requireElement('export-button') as HTMLButtonElement
const pushButton = requireElement('push-button') as HTMLButtonElement
const pushResultEl = requireElement('push-result')
const tabButtons = [...document.querySelectorAll('.tab-button')] as HTMLButtonElement[]

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function renderQuarantined(records: readonly QuarantinedRecord[]): void {
  clearChildren(rejectedList)
  if (records.length === 0) {
    setText(rejectedList, 'ไม่มีแถวที่ถูกปฏิเสธ')
    return
  }
  for (const record of records) {
    const row = document.createElement('div')
    row.className = 'quarantine-row'
    setText(row, `offset ${String(record.offset)} แถวที่ ${String(record.indexInPage)} — ${record.reasons.join(', ')}`)
    rejectedList.append(row)
  }
}

function renderPreview(): void {
  const report = state.report
  if (report === null) return

  for (const button of tabButtons) {
    button.setAttribute('aria-selected', String(button.dataset['filter'] === state.filter))
  }

  const candidateCount = productsInFilter(report.products, 'candidate').length
  const otherCount = productsInFilter(report.products, 'other').length
  setText(requireElement('count-candidate'), String(candidateCount))
  setText(requireElement('count-other'), String(otherCount))
  setText(requireElement('count-rejected'), String(report.quarantined.length))

  if (state.filter === 'rejected') {
    productList.hidden = true
    rejectedList.hidden = false
    selectAllButton.hidden = true
    deselectAllButton.hidden = true
    renderQuarantined(report.quarantined)
    setText(pageIndicatorEl, '')
    return
  }

  productList.hidden = false
  rejectedList.hidden = true
  selectAllButton.hidden = false
  deselectAllButton.hidden = false

  const filtered = productsInFilter(report.products, state.filter)
  const pages = totalPages(filtered.length, DEFAULT_PAGE_SIZE)
  state.page = Math.min(state.page, pages - 1)

  renderPreviewPage(productList, filtered, state.selected, { page: state.page }, (productId) => {
    state.selected = new Set(toggleSelection(state.selected, productId))
    renderSelectionCount()
  })

  setText(pageIndicatorEl, `หน้า ${String(state.page + 1)} / ${String(pages)}`)
  prevPageButton.disabled = state.page <= 0
  nextPageButton.disabled = state.page >= pages - 1
  renderSelectionCount()
}

function renderSelectionCount(): void {
  const report = state.report
  if (report === null) return
  const filtered = productsInFilter(report.products, state.filter === 'rejected' ? 'candidate' : state.filter)
  const count = state.filter === 'rejected' ? 0 : countSelectedInFilter(state.selected, filtered)
  setText(selectedCountEl, `เลือกในแท็บนี้: ${String(count)} / ${String(filtered.length)} · เลือกทั้งหมด: ${String(state.selected.size)}`)
}

function showIdle(message: string): void {
  clearChildren(runStatusEl)
  setText(runStatusEl, message)
  startButton.hidden = false
  cancelButton.hidden = true
  previewSection.hidden = true
}

function showRunning(message: string): void {
  clearChildren(runStatusEl)
  setText(runStatusEl, message)
  startButton.hidden = true
  cancelButton.hidden = false
  previewSection.hidden = true
}

/**
 * รายการ "ส่งแล้ว" ที่การสแกนรอบล่าสุดของหน้านี้ใช้ — null = ไม่รู้ (เปิดหน้ามาเจอผลเก่า / ปิดตัวเลือกหยุดเอง)
 * ใช้เลือกสินค้าใหม่ไว้ให้ล่วงหน้าตอนสแกนจบ ผู้ใช้จริงกด "เริ่มสแกน" แล้วกด "ส่งไปปลายทาง" เลยโดยไม่มีอะไรถูกเลือก
 * (2026-09-29) จึงไม่มีอะไรเข้าระบบเลย
 */
let lastScanKnownIds: readonly string[] | null = null

function showFinished(report: RunReport): void {
  state.report = report
  state.page = 0
  // live build ยังไม่ตัดสิน eligibility ได้ (ทุกแถวเป็น unknown) แท็บ Candidate จึงว่างเสมอ — เปิดแท็บที่มีของจริง
  state.filter = productsInFilter(report.products, 'candidate').length > 0 ? 'candidate' : 'other'
  const preselected = lastScanKnownIds === null ? [] : pickNewProductIds(report.products, lastScanKnownIds)
  state.selected = new Set(preselected)

  clearChildren(runStatusEl)

  // หยุดกลางทาง = ต้องเห็นชัดก่อนอย่างอื่น ไม่ใช่ซ่อนอยู่ในค่า enum `scanCoverage` ที่อ่านยาก
  // ผู้ใช้ที่ export ข้อมูลชุดนี้ไปใช้ต่อต้องรู้ตั้งแต่ก่อนกดว่ามันไม่ครบ
  if (report.stopReason === 'known_ids_reached') {
    // หยุดเองเพราะเจอหน้าที่มีแต่สินค้าที่ปลายทางมีแล้ว = ผลที่ต้องการ ไม่ใช่ "ข้อมูลไม่ครบ" — ผู้ใช้จริงเห็นแถบเตือนสีแดง
    // เดิมแล้วตกใจ (2026-09-29) เพราะแถบนั้นเขียนไว้ก่อนมีระบบหยุดเอง · หยุดด้วยเหตุผลอื่น (จำกัดหน้า/ยกเลิก/
    // โดน rate limit) ยังเตือนสีแดงเหมือนเดิม เพราะตอนนั้นอาจพลาดสินค้าใหม่ได้จริง
    const note = document.createElement('p')
    note.className = 'notice'
    setText(
      note,
      '✅ หยุดสแกนเองแล้ว — เจอหน้าที่มีแต่สินค้าที่เคยส่งไปแล้ว' +
        (preselected.length > 0
          ? ` · เลือกสินค้าใหม่ ${String(preselected.length)} ตัวไว้ให้แล้ว กด "ส่งไปปลายทาง" ด้านล่างได้เลย`
          : lastScanKnownIds === null
            ? ''
            : ' · ไม่มีสินค้าใหม่ที่ต้องส่ง'),
    )
    runStatusEl.append(note)
  } else if (report.scanCoverage !== 'reached_endpoint_end') {
    const banner = document.createElement('p')
    banner.className = 'banner banner-warning'
    setText(
      banner,
      `⚠ ข้อมูลยังไม่ครบ — การสแกนหยุดก่อนถึงปลายทาง (เหตุผล: ${report.stopReason}) ` +
        `สิ่งที่เห็นและ export ได้ตอนนี้เป็นเพียงส่วนหนึ่งของ Showcase เท่านั้น`,
    )
    runStatusEl.append(banner)
  }

  appendLabeledRow(runStatusEl, 'สถานะ', report.state)
  appendLabeledRow(
    runStatusEl,
    'ผลการสแกน',
    report.scanCoverage === 'reached_endpoint_end'
      ? 'reached_endpoint_end — อ่านครบถึงปลายทางที่ API แจ้ง'
      : `${report.scanCoverage} — ไม่ครบ`,
  )
  appendLabeledRow(runStatusEl, 'เหตุผลที่หยุด', report.stopReason)
  appendLabeledRow(runStatusEl, 'คุณภาพข้อมูล', report.dataQuality)
  appendLabeledRow(runStatusEl, 'หน้าที่อ่านสำเร็จ', String(report.counters.successfulPages))
  appendLabeledRow(runStatusEl, 'สินค้าที่ใช้ได้', String(report.counters.uniqueValidProducts))
  appendLabeledRow(runStatusEl, 'แถวที่ถูกปฏิเสธ', String(report.counters.invalidRows))
  if (report.warnings.length > 0) {
    appendLabeledRow(runStatusEl, 'คำเตือน', report.warnings.join(', '))
  }
  if (report.resumeAfterMs !== null) {
    appendLabeledRow(runStatusEl, 'เริ่มใหม่ได้ในอีก', `${String(Math.ceil(report.resumeAfterMs / 1000))} วินาที`)
  }

  startButton.hidden = false
  cancelButton.hidden = true
  previewSection.hidden = false
  renderPreview()
}

async function pollStatus(): Promise<void> {
  if (state.polling) return
  state.polling = true
  try {
    for (;;) {
      const status = await send({ type: 'run.status' })
      if (!status.ok) {
        showIdle(`อ่านสถานะไม่ได้: ${status.code}`)
        return
      }

      if (status.phase === 'finished' && status.report !== null) {
        showFinished(status.report)
        return
      }

      if (status.phase === 'running') {
        const staged = status.resume?.kind === 'running' ? status.resume.productCount : 0
        showRunning(`กำลังสแกน… สินค้าที่เก็บแล้ว ${String(staged)} รายการ`)
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        continue
      }

      // idle
      // lease กำพร้า (registry ว่างแต่ lease ยังไม่หมดอายุ) ถูกแปลงเป็น 'interrupted' แล้วที่ฝั่ง
      // service worker (extension/src/messaging/handle.ts, case 'run.status') — ไม่ต้องเช็คซ้ำที่นี่
      if (status.resume?.kind === 'interrupted') {
        showIdle(
          `การสแกนก่อนหน้าถูกขัดจังหวะ มีสินค้า staged แล้ว ${String(status.resume.productCount)} รายการ — เริ่มสแกนใหม่ได้`,
        )
      } else {
        showIdle('พร้อมเริ่มสแกน')
      }
      return
    }
  } finally {
    state.polling = false
  }
}

const maxPagesInput = requireElement('max-pages-input') as HTMLInputElement

/**
 * ช่องว่าง = ไม่จำกัด (สแกนจนจบ) — ค่าที่ไม่ใช่จำนวนเต็มบวกถือเป็นช่องว่างเหมือนกัน (กันพิมพ์ผิดแล้ว
 * ได้ maxPages แปลก ๆ โดยไม่รู้ตัว ปลอดภัยกว่าปฏิเสธด้วย error เพราะจุดประสงค์แค่ลดความเสี่ยง
 * ไม่ใช่ฟีเจอร์ที่ต้อง strict validation เหมือนข้อความจากภายนอก)
 */
const readMaxPages = (): number | null => {
  const raw = maxPagesInput.value.trim()
  if (raw === '') return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

for (const [id, value] of [
  ['max-pages-1', '1'],
  ['max-pages-2', '2'],
  ['max-pages-all', ''],
] as const) {
  requireElement(id).addEventListener('click', () => {
    maxPagesInput.value = value
  })
}

startButton.addEventListener('click', () => {
  void (async () => {
    const knownProductIds = await resolveKnownProductIds()
    lastScanKnownIds = knownProductIds
    const result = await send({ type: 'run.start', maxPages: readMaxPages(), knownProductIds })
    if (!result.ok) {
      showIdle(`เริ่มสแกนไม่ได้: ${result.code}`)
      return
    }
    void pollStatus()
  })()
})

cancelButton.addEventListener('click', () => {
  void send({ type: 'run.cancel' })
})

// PK05 — ยืนยันสองจังหวะแทน window.confirm (dialog เนทีฟทำให้ automation และ keyboard flow ยุ่งยาก):
// คลิกแรกแค่ติดอาวุธ (เปลี่ยนข้อความปุ่ม) คลิกที่สองจึงล้างจริง
let clearArmed = false

clearDataButton.addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true
    setText(clearDataButton, 'กดอีกครั้งเพื่อยืนยันการล้าง')
    return
  }
  void (async () => {
    const result = await send({ type: 'data.clear' })
    clearArmed = false
    setText(clearDataButton, 'ล้างข้อมูลที่เก็บไว้')
    if (!result.ok) {
      showIdle(`ล้างข้อมูลไม่ได้: ${result.code}`)
      return
    }
    state.report = null
    state.selected = new Set()
    state.page = 0
    showIdle('ล้างข้อมูลแล้ว')
  })()
})

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    const filter = button.dataset['filter']
    if (filter === 'candidate' || filter === 'other' || filter === 'rejected') {
      state.filter = filter
      state.page = 0
      renderPreview()
    }
  })
}

selectAllButton.addEventListener('click', () => {
  const report = state.report
  if (report === null || state.filter === 'rejected') return
  const filtered = productsInFilter(report.products, state.filter)
  state.selected = new Set(selectAllInFilter(state.selected, filtered))
  renderPreview()
})

deselectAllButton.addEventListener('click', () => {
  const report = state.report
  if (report === null || state.filter === 'rejected') return
  const filtered = productsInFilter(report.products, state.filter)
  state.selected = new Set(deselectAllInFilter(state.selected, filtered))
  renderPreview()
})

prevPageButton.addEventListener('click', () => {
  state.page = Math.max(0, state.page - 1)
  renderPreview()
})

nextPageButton.addEventListener('click', () => {
  state.page += 1
  renderPreview()
})

exportButton.addEventListener('click', () => {
  void (async () => {
    const result = await send({ type: 'run.export', selectedIds: [...state.selected] })
    if (!result.ok) {
      window.alert(`export ไม่สำเร็จ: ${result.code}`)
      return
    }
    downloadJson(`flow-a-export-${result.payload.runId}.json`, result.payload)
  })()
})

/** ส่งสินค้าที่เลือกอยู่ไปปลายทาง — คืนข้อความผลลัพธ์ (ใช้ทั้งปุ่ม "ส่งไปปลายทาง" และโหมดอัตโนมัติ) */
async function pushSelectedToDestination(): Promise<{ ok: boolean; message: string }> {
  const result = await send({ type: 'run.export', selectedIds: [...state.selected] })
  if (!result.ok) return { ok: false, message: `เตรียมข้อมูลไม่สำเร็จ: ${result.code}` }
  const sent = await deliver(result.payload)
  if (!sent.ok) return sent
  const parts = [`✅ ส่งไปปลายทางแล้ว ${String(sent.count)} รายการ`]
  if (sent.added !== undefined && sent.added > 0) parts.push(`เพิ่มใหม่ ${String(sent.added)}`)
  if (sent.skipped !== undefined && sent.skipped > 0) parts.push(`ข้าม ${String(sent.skipped)}`)
  if (sent.imagesFailed !== undefined && sent.imagesFailed > 0) parts.push(`โหลดรูปพลาด ${String(sent.imagesFailed)}`)
  return { ok: true, message: parts.join(' · ') }
}

pushButton.addEventListener('click', () => {
  void (async () => {
    if (state.selected.size === 0) {
      setText(pushResultEl, 'ยังไม่ได้เลือกสินค้า')
      return
    }
    setText(pushResultEl, 'กำลังส่ง…')
    setText(pushResultEl, (await pushSelectedToDestination()).message)
  })()
})

// ---------- โหมดอัตโนมัติ: ปุ่มสแกน+ส่งใน popup (คำสั่งผ่าน storage.session —
// ดู requestAutoScan ใน destination.ts) ----------
//
// สแกนแบบหยุดเมื่อเจอหน้าที่มีแต่สินค้าที่ปลายทางรู้จักแล้ว → เลือกเฉพาะตัวที่ปลายทางยังไม่มี → ส่งไปปลายทาง
// ทำในหน้านี้ ไม่ใช่ใน popup เพราะ popup ปิดทันทีที่ผู้ใช้คลิกที่อื่น งานจะขาดกลางทาง
//
// ห้ามสแกนเต็มแล้วส่งทั้งก้อนเมื่อถามรายการ "รู้จักแล้ว" จากปลายทางไม่ได้ — จะได้สินค้าเก่าซ้ำเข้าไปทั้ง
// Showcase (ร้อยกว่าตัว) จึงหยุดแล้วบอกผู้ใช้แทน · หยุดด้วยเหตุผลอื่นที่ไม่ใช่ "ถึงปลายทาง/เจอหน้าที่
// รู้จักแล้ว" (เช่น login TikTok หลุด) = ไม่ส่งอัตโนมัติ ให้ผู้ใช้ดูผลแล้วตัดสินใจเอง
const autoStatusEl = requireElement('auto-status')

function setAutoStatus(text: string, tone: 'info' | 'warning'): void {
  autoStatusEl.hidden = false
  autoStatusEl.className = tone === 'warning' ? 'notice notice-warning' : 'notice'
  setText(autoStatusEl, text)
}

async function runAutoScanAndPush(): Promise<void> {
  const autoStop = requireElement('auto-stop-known-checkbox') as HTMLInputElement
  autoStop.checked = true
  // ไม่มีลิงก์ = สแกนไปก็ส่งไม่ได้ และห้ามสแกนเต็มแล้วส่งซ้ำทั้งก้อนเมื่อถามรายการ "ส่งแล้ว" ไม่ได้
  if ((await getDestinationLink()) === '') {
    setAutoStatus('ยังไม่ได้ใส่ลิงก์ปลายทาง — ใส่ที่ส่วน "ตั้งค่า" ก่อน ยังไม่ได้สแกนอะไร', 'warning')
    settingsEl.open = true
    return
  }
  setAutoStatus('สแกนอัตโนมัติ: กำลังถามรายการสินค้าที่ส่งไปแล้ว…', 'info')
  const known = await resolveKnownIds()
  if (known === null) {
    setAutoStatus('ติดต่อปลายทางไม่ได้ หรือลิงก์ใช้ไม่ได้แล้ว — ยังไม่ได้สแกนอะไร', 'warning')
    return
  }
  const knownProductIds = known.ids
  lastScanKnownIds = knownProductIds

  // ล้างผลเก่าก่อน — ถ้ารอบนี้จบแบบไม่มี report (อ่านสถานะไม่ได้/idle) ต้องไม่หยิบผลสแกนรอบก่อน
  // (ที่ poll รอบแรกโหลดมาโชว์) ไปส่งแทน
  state.report = null
  const started = await send({ type: 'run.start', maxPages: null, knownProductIds })
  if (!started.ok) {
    setAutoStatus(`สแกนอัตโนมัติเริ่มไม่ได้: ${started.code}`, 'warning')
    return
  }
  setAutoStatus('สแกนอัตโนมัติ: กำลังสแกนหาสินค้าใหม่ใน Showcase…', 'info')
  await pollStatus()

  // pollStatus เขียน state.report ผ่าน showFinished — TS ยังจำการตั้ง null ด้านบนไว้ จึงต้องบอกชนิดตรงๆ
  const report = state.report as RunReport | null
  if (report === null) {
    setAutoStatus('สแกนอัตโนมัติ: สแกนไม่จบ — ดูสถานะด้านล่าง', 'warning')
    return
  }
  if (report.stopReason !== 'known_ids_reached' && report.stopReason !== 'endpoint_end') {
    setAutoStatus(`สแกนหยุดก่อนจบ (${report.stopReason}) — ยังไม่ได้ส่งอะไรไปปลายทาง ดูผลด้านล่างแล้วตัดสินใจเอง`, 'warning')
    return
  }

  const newIds = pickNewProductIds(report.products, knownProductIds)
  if (newIds.length === 0) {
    setAutoStatus('✅ ไม่มีสินค้าใหม่ — ทุกตัวใน Showcase ส่งไปปลายทางแล้ว', 'info')
    return
  }

  state.selected = new Set(newIds)
  renderPreview()
  setAutoStatus(`สแกนอัตโนมัติ: เจอสินค้าใหม่ ${String(newIds.length)} ตัว กำลังส่งไปปลายทาง…`, 'info')
  const pushed = await pushSelectedToDestination()
  setAutoStatus(pushed.message, pushed.ok ? 'info' : 'warning')
}

renderChannelBanner()
void renderBuildInfo()
void refreshDestination()
void (async () => {
  // รอ poll รอบแรกจบก่อนเสมอ — pollStatus กันการ poll ซ้อน (state.polling) ถ้าโหมดอัตโนมัติเริ่มสแกน
  // ระหว่างที่รอบแรกยังวิ่งอยู่ การรอผลสแกนจะหลุดทันทีโดยไม่เห็นผลจริง
  await pollStatus()
  // คำสั่งใช้ครั้งเดียว — refresh หน้านี้ทีหลังจะไม่สแกน/ส่งซ้ำเอง
  if (await consumeAutoScanRequest()) await runAutoScanAndPush()
})()
