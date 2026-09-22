import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'

const OUT = 'dist-release'

describe('PK02/PK03 — release bundle (R11/R15)', () => {
  let release = ''

  beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build.mjs', '--mode=live', `--out=${OUT}`], {
      stdio: 'pipe',
    })
    const files = globSync(`${OUT}/**/*.{js,html,css,json}`)
    expect(files.length).toBeGreaterThan(0)
    release = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  }, 120_000)

  it('PK03 (หลัก): esbuild metafile พิสูจน์ระดับ module ว่าไม่มี mock/fixture เข้า bundle', () => {
    const meta = JSON.parse(readFileSync(`${OUT}/meta.json`, 'utf8')) as {
      inputs: Record<string, unknown>
    }
    const inputs = Object.keys(meta.inputs)
    expect(inputs.length).toBeGreaterThan(0) // กัน vacuous pass จาก path ผิด
    for (const input of inputs) {
      expect(input, input).not.toMatch(/adapters[/\\]mock-|resolve\.mock|[/\\]fixtures?[/\\]|[/\\]tests?[/\\]/)
    }
  })

  it('PK03 (รอง): grep ไม่พบ mock adapter, fixture หรือ mock mode ใน release bundle', () => {
    expect(release).toContain('Flow A') // positive control — พิสูจน์ว่า scanner อ่าน byte จริง
    for (const marker of [
      'createMockShowcaseAdapter',
      'mock-v0',
      '1736749159048840633',
      'mock_script_exhausted',
      'MockPageScript',
    ]) {
      expect(release, marker).not.toContain(marker)
    }
  })

  it('PK03: ไม่มีทางเปิด mock/debug จาก runtime — ไม่อ่าน query string หรือ storage key ที่ชื่อชวนสงสัย', () => {
    expect(release).not.toContain('location.search')
    expect(release).not.toContain('URLSearchParams')
    expect(release).not.toMatch(/["'`][^"'`]*(debug|mock|override|bypass)[^"'`]*["'`]\s*\]/i)
  })

  it('PK03: release ไม่มี onMessageExternal และ manifest ไม่มี externally_connectable', () => {
    expect(release).not.toContain('onMessageExternal')
    const manifest = JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8')) as Record<string, unknown>
    expect(manifest.externally_connectable).toBeUndefined()
  })

  it('PK02: ไม่มี eval, new Function หรือ remote script', () => {
    expect(release).not.toMatch(/\beval\s*\(/)
    expect(release).not.toMatch(/new\s+Function\s*\(/)
    expect(release).not.toMatch(/<script[^>]+src=["']https?:/)
    expect(release).not.toMatch(/\.(innerHTML|outerHTML)\s*=/)
  })

  it('dist มี manifest, background และหน้าทั้งสอง', () => {
    for (const file of ['manifest.json', 'background.js', 'dashboard/index.html', 'popup/index.html']) {
      expect(() => readFileSync(`${OUT}/${file}`, 'utf8'), file).not.toThrow()
    }
  })

  it('build-info มี buildHash และระบุ adapterMode เป็น live', () => {
    const info = JSON.parse(readFileSync(`${OUT}/build-info.json`, 'utf8')) as Record<string, unknown>
    expect(info.adapterMode).toBe('live')
    expect(info.schemaVersion).toBe(1)
    expect(String(info.buildHash)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('release bundle มี live adapter จริงอยู่ข้างใน (positive control กัน false pass จาก tree-shaking พลาด)', () => {
    expect(release).toContain('shop.tiktok.com')
    expect(release).toContain('streamer_desktop')
  })

  it('dev/mock channel ไม่มี live adapter (fetch-based transport) ปนอยู่เลย — แยกกันทั้งสองทาง', () => {
    execFileSync(process.execPath, ['scripts/build.mjs', '--mode=mock', '--out=dist'], { stdio: 'pipe' })
    const dev = readFileSync('dist/background.js', 'utf8')
    for (const marker of ['shop.tiktok.com', 'streamer_desktop', 'createFetchTransport', 'redirect: "manual"']) {
      expect(dev, marker).not.toContain(marker)
    }
  })

  it('dev channel ต่างจาก release ได้เฉพาะป้ายกำกับ — กัน permission drift', () => {
    execFileSync(process.execPath, ['scripts/build.mjs', '--mode=mock', '--out=dist'], { stdio: 'pipe' })
    const dev = JSON.parse(readFileSync('dist/manifest.json', 'utf8')) as Record<string, unknown>
    const rel = JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8')) as Record<string, unknown>
    const differing = Object.keys({ ...dev, ...rel }).filter(
      (key) => JSON.stringify(dev[key]) !== JSON.stringify(rel[key]),
    )
    // อนุญาตให้ต่างได้เฉพาะ field ที่เป็นข้อความอธิบายให้มนุษย์อ่าน ซึ่งไม่มีผลต่อสิทธิ์หรือความสามารถ
    // ของ extension เลย — ทุก field ที่เหลือ (permissions, host permissions, CSP, entry points ฯลฯ)
    // ต้องเหมือนกันเป๊ะ ไม่งั้น dev build จะพิสูจน์อะไรเกี่ยวกับ release build ไม่ได้
    const COSMETIC_ONLY = ['name', 'description']
    expect(differing.filter((key) => !COSMETIC_ONLY.includes(key))).toEqual([])
    // และต้องต่างที่ชื่อจริง ๆ ไม่ใช่เหมือนกันทั้งหมดจนแยก build ไม่ออก
    expect(differing).toContain('name')
  }, 120_000)

  it('PK02: ไม่มี secret-like pattern ใน release bundle', () => {
    const matches = release.match(/(api[_-]?key|client[_-]?secret|passwd|password|bearer\s+[a-z0-9])/gi)
    expect(matches ?? []).toEqual([])
  })

  it('PK02: ไม่มีการอ้างถึง chrome.cookies ที่ใดเลย', () => {
    expect(release).not.toContain('chrome.cookies')
    expect(release).not.toContain('cookieStore')
  })

  it('PK02: service worker ไม่มีเส้นทางขอ permission เอง (ต้องมาจาก user gesture ในหน้า extension เท่านั้น)', () => {
    const background = readFileSync(`${OUT}/background.js`, 'utf8')
    expect(background).not.toContain('permissions.request')
  })

  it('PK02: ไม่มี general-purpose credential export — ไม่มี API ที่อ่าน storage ทั้งก้อนส่งออก', () => {
    expect(release).not.toMatch(/chrome\.storage\.\w+\.get\(\s*null\s*\)/)
    expect(release).not.toContain('chrome.storage.sync')
  })
})
