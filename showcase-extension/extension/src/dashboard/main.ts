import type { QuarantinedRecord, RunReport } from '../core/runner.js'
import { SHOWCASE_HOST_PERMISSION_ORIGIN } from '../domain/permissions.js'
import type { NormalizedProduct } from '../domain/product.js'
import { buildProbeExport } from '../export/json.js'
import type { ScannerMessage, ScannerMessageType, ResponseMap } from '../messaging/schema.js'
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
// HTML มีข้อความของ mock channel เป็นค่าเริ่มต้น (E2E ตรวจคำว่า MOCK-ONLY อยู่) — live channel
// ต้องไม่โฆษณาตัวเองว่า mock เพราะมันยิง TikTok จริงได้เมื่อผู้ใช้กดเอง และต้องบอกให้ชัดว่ายัง
// ไม่ได้รับอนุญาตจาก TikTok + ยังไม่เปิด full scan
function renderChannelBanner(): void {
  if (__ADAPTER_MODE__ !== 'live') return
  setText(
    requireElement('channel-banner'),
    'LIVE TRIAL BUILD — ทดลองอ่านหนึ่งหน้าด้วยการกดเองเท่านั้น · full scan ยังปิดอยู่ · ' +
      'TikTok ยังไม่ได้อนุญาตการเข้าถึงอัตโนมัติ (ดู docs/api-observations.md §3.1)',
  )
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

// ---------- สิทธิ์เข้าถึง shop.tiktok.com (§7.1, UI06) ----------
//
// เช็ค/ขอสิทธิ์จากหน้า dashboard นี้โดยตรง ไม่ผ่าน background message เลย เพราะ chrome.permissions
// เรียกได้จากทุก extension context อยู่แล้ว และ chrome.permissions.request ต้องมาจาก user gesture
// แบบ synchronous เท่านั้น — ผ่าน message channel จะเสีย gesture context ระหว่างทาง
// (PK02 มี static check ยืนยันว่า background.js ไม่มี permissions.request เลย)

const permissionStatusEl = requireElement('permission-status')
const grantPermissionButton = requireElement('grant-permission-button') as HTMLButtonElement

async function refreshPermissionStatus(): Promise<void> {
  const granted = await chrome.permissions.contains({ origins: [SHOWCASE_HOST_PERMISSION_ORIGIN] })
  clearChildren(permissionStatusEl)
  if (granted) {
    setText(permissionStatusEl, `✅ มีสิทธิ์เข้าถึง ${SHOWCASE_HOST_PERMISSION_ORIGIN} แล้ว`)
    grantPermissionButton.hidden = true
  } else {
    setText(permissionStatusEl, `ยังไม่มีสิทธิ์เข้าถึง ${SHOWCASE_HOST_PERMISSION_ORIGIN}`)
    grantPermissionButton.hidden = false
  }
}

grantPermissionButton.addEventListener('click', () => {
  // ต้องเรียก chrome.permissions.request เป็นบรรทัดแรกในนี้ (ไม่มี await คั่นก่อน) เพื่อรักษา
  // user gesture ไว้ — ขอสิทธิ์แค่ origin เดียวที่ manifest ประกาศไว้ ไม่ขอเพิ่มเกิน spec
  void chrome.permissions
    .request({ origins: [SHOWCASE_HOST_PERMISSION_ORIGIN] })
    .then(() => refreshPermissionStatus())
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

function showFinished(report: RunReport): void {
  state.report = report
  state.selected = new Set()
  state.page = 0
  state.filter = 'candidate'

  clearChildren(runStatusEl)

  // หยุดกลางทาง = ต้องเห็นชัดก่อนอย่างอื่น ไม่ใช่ซ่อนอยู่ในค่า enum `scanCoverage` ที่อ่านยาก
  // ผู้ใช้ที่ export ข้อมูลชุดนี้ไปใช้ต่อต้องรู้ตั้งแต่ก่อนกดว่ามันไม่ครบ
  if (report.scanCoverage !== 'reached_endpoint_end') {
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
    const result = await send({ type: 'run.start', maxPages: readMaxPages() })
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

renderChannelBanner()
void renderBuildInfo()
void refreshPermissionStatus()
void pollStatus()
