import { setText } from '../dashboard/dom.js'

/**
 * หน้า "วิธีใช้" — คำตอบของ "ติดตั้งแล้วต้องทำอะไรต่อ" ที่อยู่ในตัว extension เอง (2026-09-29: ผู้ใช้จริงติดตั้ง
 * จาก zip แล้วไม่เห็นคู่มือเลย เพราะเป็นไฟล์ .md ที่ไม่มีใครเปิด) · เปิดเองตอนติดตั้งครั้งแรก (background.ts)
 * และมีลิงก์จาก popup / หน้าจัดการ
 *
 * คู่มือเต็มกับโค้ดตัวอย่างถูก build.mjs ก๊อปมาไว้ข้างๆ หน้านี้ (help/INTEGRATION.md, help/quickstart-node.mjs)
 * จึงเป็นสำเนาเดียวกับ docs/ เสมอ — อ่านผ่าน fetch ของไฟล์ในตัว extension เอง ไม่แตะ network ภายนอก
 */
const requireElement = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`missing element: ${id}`)
  return el
}

// บรรทัดแรกให้ผู้ใช้แก้เอง — AI ต้องรู้ว่าจะต่อเข้าระบบอะไร ไม่งั้นมักเดาเป็น Express ทุกครั้ง
// ถ้าผู้ใช้ลืมแก้บรรทัดแรก AI ต้องถามกลับ ไม่ใช่เดาเอง (เจอจริง 2026-09-29: วางทั้งก้อนโดยไม่แก้)
const AI_PROMPT_HEADER =
  'ช่วยสร้าง "ปลายทาง" สำหรับ Showcase Scanner ตามคู่มือด้านล่างให้หน่อย ระบบของฉันคือ: [แก้ตรงนี้ เช่น Google Sheets / เว็บ Next.js / n8n / Supabase]\n' +
  'เสร็จแล้วบอกลิงก์ปลายทางที่ต้องเอาไปวางใน extension และวิธีทดสอบ\n' +
  '(ถึง AI: ถ้าบรรทัด "ระบบของฉันคือ" ยังเป็นข้อความในวงเล็บเหลี่ยม ให้ถามผู้ใช้ก่อนว่าใช้ระบบอะไร อย่าเดาเอง · ' +
  'ไฟล์ในโฟลเดอร์ examples/ ที่คู่มืออ้างถึง ผู้ใช้อาจไม่ได้ส่งมา — โค้ดของ examples/quickstart-node.mjs แนบไว้ท้ายข้อความนี้แล้ว)\n\n---\n\n'

// คู่มืออ้าง examples/quickstart-node.mjs แต่ AI ที่ได้แค่ข้อความจะไม่มีไฟล์นั้น — แนบโค้ดไปด้วยเสมอ
const withQuickstart = (guide: string, code: string): string =>
  `${AI_PROMPT_HEADER}${guide}\n\n---\n\n## ภาคผนวก: examples/quickstart-node.mjs (โค้ดเต็ม รันได้จริง)\n\n\`\`\`js\n${code}\`\`\`\n`

const statusEl = requireElement('help-status')
function showStatus(text: string): void {
  statusEl.hidden = false
  setText(statusEl, text)
}

async function readBundled(path: string): Promise<string> {
  const res = await fetch(chrome.runtime.getURL(path))
  if (!res.ok) throw new Error(`โหลด ${path} ไม่ได้ (${String(res.status)})`)
  return res.text()
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    showStatus(done)
  } catch {
    showStatus('คัดลอกไม่สำเร็จ — ลองกดอีกครั้ง หรือเลือกข้อความแล้วคัดลอกเอง')
  }
}

const codePromise = readBundled('help/quickstart-node.mjs')
const guidePromise = readBundled('help/INTEGRATION.md')
const codeEl = requireElement('quickstart-code')

void codePromise.then(
  (code) => setText(codeEl, code),
  () => setText(codeEl, 'โหลดโค้ดตัวอย่างไม่ได้ — ดูไฟล์ developer/examples/quickstart-node.mjs ในโฟลเดอร์ที่แตกจาก zip'),
)

requireElement('open-dashboard').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

requireElement('copy-ai').addEventListener('click', () => {
  void Promise.all([guidePromise, codePromise]).then(
    ([guide, code]) =>
      copy(withQuickstart(guide, code), '✅ คัดลอกคู่มือแล้ว — วางในแชทของ AI แล้วแก้บรรทัดแรกให้บอกว่าระบบของคุณคืออะไร'),
    () => showStatus('โหลดคู่มือไม่ได้ — ใช้ไฟล์ developer/INTEGRATION.md ในโฟลเดอร์ที่แตกจาก zip แทน'),
  )
})

requireElement('copy-code').addEventListener('click', () => {
  void codePromise.then(
    (code) => copy(code, '✅ คัดลอกโค้ดแล้ว — บันทึกเป็นไฟล์ quickstart-node.mjs แล้วรัน node quickstart-node.mjs'),
    () => showStatus('โหลดโค้ดตัวอย่างไม่ได้'),
  )
})

requireElement('download-code').addEventListener('click', () => {
  void codePromise.then((code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'quickstart-node.mjs'
    anchor.click()
    URL.revokeObjectURL(url)
    showStatus('✅ ดาวน์โหลดแล้ว — รัน node quickstart-node.mjs ในโฟลเดอร์ที่บันทึกไฟล์')
  })
})
