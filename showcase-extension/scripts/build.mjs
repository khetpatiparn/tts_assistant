import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'extension', 'src')

const readFlag = (name, fallback) => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}

const mode = readFlag('mode', 'live')
const outDir = resolve(ROOT, readFlag('out', 'dist'))

if (mode !== 'mock' && mode !== 'live') {
  throw new Error(`unknown --mode=${mode} (expected "mock" or "live")`)
}

// เลือก adapter ตอน compile ผ่าน alias — release จึงไม่ parse ไฟล์ mock เลย
// ไม่พึ่ง tree-shaking ซึ่งพิสูจน์ไม่ได้ (PK03)
const adapterEntry = join(SRC, 'adapters', mode === 'mock' ? 'resolve.mock.ts' : 'resolve.live.ts')

const collect = async (dir) => {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(full)))
    else out.push(full)
  }
  return out
}

// แฮชจาก source + channel ไม่ใช่จาก output เพื่อให้ inject เข้า bundle ได้ในรอบเดียว
// และให้ build เดิมจาก commit เดิมได้ hash เดิมเสมอ
// เอกสารที่ถูกก๊อปเข้า help/ ต้องอยู่ในแฮชด้วย ไม่งั้นแก้คู่มืออย่างเดียวแล้ว build hash ไม่เปลี่ยน
const HELP_DOCS = [
  ['docs/INTEGRATION.md', 'help/INTEGRATION.md'],
  ['docs/examples/quickstart-node.mjs', 'help/quickstart-node.mjs'],
]
const sources = [
  ...(await collect(SRC)),
  join(ROOT, 'extension', 'manifest.json'),
  ...HELP_DOCS.map(([from]) => join(ROOT, from)),
].sort()
const digest = createHash('sha256').update(mode)
for (const file of sources) {
  digest.update(relative(ROOT, file).split('\\').join('/'))
  digest.update(await readFile(file))
}
const buildHash = digest.digest('hex')

// ล้าง "เนื้อใน" ไม่ใช่ตัวโฟลเดอร์เอง — บน Windows การลบโฟลเดอร์ที่ process อื่นใช้เป็น CWD อยู่
// (เช่นเชลล์ที่ cd เข้าไปดูไฟล์ หรือเบราว์เซอร์ที่ load unpacked ค้างไว้) จะล้มด้วย EBUSY
// การเก็บตัวโฟลเดอร์ไว้ยังทำให้ path ที่ Chrome จำไว้ตอน Load unpacked ใช้ต่อได้โดยไม่ต้องเลือกใหม่
await mkdir(outDir, { recursive: true })
for (const entry of await readdir(outDir)) {
  const target = join(outDir, entry)
  try {
    await rm(target, { recursive: true, force: true })
  } catch (error) {
    throw new Error(
      [
        `ลบของเดิมใน ${relative(ROOT, outDir)} ไม่ได้: ${relative(ROOT, target)}`,
        'สาเหตุที่พบบ่อยบน Windows: มีเชลล์ cd ค้างอยู่ในโฟลเดอร์นี้ หรือเบราว์เซอร์ยังเปิดไฟล์อยู่',
        'ทางแก้: cd ออกจากโฟลเดอร์ก่อน แล้วถ้ายังไม่หาย ให้ Remove extension ในหน้า extensions แล้ว build ใหม่',
        `รายละเอียดเดิม: ${error.message}`,
      ].join('\n'),
    )
  }
}

const result = await build({
  entryPoints: {
    background: join(SRC, 'background.ts'),
    'dashboard/main': join(SRC, 'dashboard', 'main.ts'),
    'popup/main': join(SRC, 'popup', 'main.ts'),
    'help/main': join(SRC, 'help', 'main.ts'),
  },
  outdir: outDir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome124',
  // ไม่ minify: PK02 ต้องให้คนอ่าน bundle รีวิวได้ และ grep ต้องเจอชื่อจริง
  // ขนาดไฟล์ไม่สำคัญสำหรับ unpacked extension
  minify: false,
  treeShaking: true,
  legalComments: 'none',
  drop: ['debugger'],
  metafile: true,
  alias: { '#adapter': adapterEntry },
  define: {
    __ADAPTER_MODE__: JSON.stringify(mode),
    __BUILD_HASH__: JSON.stringify(buildHash.slice(0, 16)),
  },
})

await writeFile(join(outDir, 'meta.json'), `${JSON.stringify(result.metafile, null, 2)}\n`, 'utf8')

const manifest = JSON.parse(await readFile(join(ROOT, 'extension', 'manifest.json'), 'utf8'))
if (mode === 'mock') {
  manifest.name = 'Showcase Scanner (DEV MOCK, not live-ready)'
  manifest.description =
    'อ่านรายการสินค้าใน Showcase ของบัญชีตนเองเพื่อ preview และ export JSON — build นี้ใช้ fixture สังเคราะห์ล้วน ไม่แตะเครือข่ายเลย'
}
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

for (const page of ['dashboard', 'popup', 'help']) {
  for (const asset of await readdir(join(SRC, page))) {
    if (asset.endsWith('.html') || asset.endsWith('.css')) {
      await cp(join(SRC, page, asset), join(outDir, page, asset))
    }
  }
}

// หน้า "วิธีใช้" อ่านคู่มือเต็มกับโค้ดตัวอย่างจากไฟล์ในตัว extension (help/main.ts) — ก๊อปจาก docs/ ทุก build
// จึงเป็นสำเนาเดียวกันเสมอ · .md/.mjs ไม่อยู่ใน glob ของ PK02 (js/html/css/json) และไม่ถูก execute
for (const [from, to] of HELP_DOCS) await cp(join(ROOT, from), join(outDir, to))

// icons/*.png ที่ manifest.json อ้างถึง (icons + action.default_icon) — .svg เป็นไฟล์ source
// เก็บไว้แก้ต่อได้เท่านั้น ไม่ต้องอยู่ใน bundle เพราะไม่มีที่ไหนอ้างถึงมันเลย
await mkdir(join(outDir, 'icons'), { recursive: true })
for (const asset of await readdir(join(SRC, 'icons'))) {
  if (asset.endsWith('.png')) await cp(join(SRC, 'icons', asset), join(outDir, 'icons', asset))
}

await writeFile(
  join(outDir, 'build-info.json'),
  `${JSON.stringify(
    { buildHash, adapterMode: mode, schemaVersion: 1, builtAt: new Date().toISOString() },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`built ${mode} channel → ${relative(ROOT, outDir)} (${buildHash.slice(0, 12)}…)`)
