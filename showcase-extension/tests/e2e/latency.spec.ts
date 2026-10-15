import { test, expect } from './fixtures/extension.js'

interface Sample {
  readonly at: number
  readonly displayed: number | null
  readonly committed: number
  readonly lastCommitAt: number | null
}

test('§16 — progress แสดงภายใน 1 วินาทีหลัง commit หน้า', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await page.locator('#start-button').click()

  const samples: Sample[] = await page.evaluate(async () => {
    const out: {
      at: number
      displayed: number | null
      committed: number
      lastCommitAt: number | null
    }[] = []
    const deadline = Date.now() + 30_000

    for (;;) {
      const status = await chrome.runtime.sendMessage({ type: 'run.status' })
      const text = document.querySelector('#run-status')?.textContent ?? ''
      const match = /(\d+)\s*รายการ/.exec(text)

      const resume = status?.resume ?? null
      out.push({
        at: Date.now(),
        displayed: match?.[1] === undefined ? null : Number(match[1]),
        committed: typeof resume?.productCount === 'number' ? resume.productCount : 0,
        lastCommitAt:
          typeof resume?.checkpoint?.lastCommitAt === 'number' ? resume.checkpoint.lastCommitAt : null,
      })

      if (status?.phase === 'finished') break
      if (Date.now() > deadline) break
      // 50 ms ให้ความละเอียดเหลือเฟือเทียบงบ 1000 ms โดยไม่สร้างภาระให้ระบบที่กำลังวัด
      await new Promise((r) => setTimeout(r, 50))
    }
    return out
  })

  // ต้องได้ตัวอย่างที่เห็น commit จริงมากกว่าศูนย์ มิฉะนั้นการวัดเป็น vacuous
  const withCommits = samples.filter((s) => s.lastCommitAt !== null && s.committed > 0)
  expect(withCommits.length).toBeGreaterThan(0)

  // ช่วงที่จอแสดงน้อยกว่าที่ commit จริง = กำลังล้าหลัง
  const staleAges = withCommits
    .filter((s) => (s.displayed ?? 0) < s.committed)
    .map((s) => s.at - (s.lastCommitAt as number))

  const worst = staleAges.length === 0 ? 0 : Math.max(...staleAges)
  console.log(`[วัดจริง] progress lag สูงสุด = ${String(worst)} ms จาก ${String(samples.length)} ตัวอย่าง`)
  expect(worst).toBeLessThanOrEqual(1000)
})

// หมายเหตุความถูกต้องของการวัด: loop นี้ยิง run.status เองด้วย จึงเพิ่มภาระให้ระบบที่กำลังวัดเล็กน้อย
// ผลที่ได้จึงเป็นขอบบน (upper bound) ของ latency จริง — ผ่านเกณฑ์แล้วถือว่าผ่านจริงอย่างปลอดภัย
// บันทึกข้อสังเกตนี้ลง docs/test-results.md ใน Task 10 ด้วย

test('§16 — Cancel เปลี่ยนสถานะ UI ภายใน 2 วินาที และไม่มี commit เพิ่มหลังจากนั้น', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await page.locator('#start-button').click()
  // รอให้ commit อย่างน้อยหนึ่งหน้า เพื่อให้ cancel เกิดกลาง run จริง
  await expect(page.locator('#run-status')).toContainText(/[1-9]\d*\s*รายการ/, { timeout: 20_000 })

  const measured = await page.evaluate(async () => {
    const clickedAt = Date.now()
    ;(document.querySelector('#cancel-button') as HTMLButtonElement).click()

    const deadline = clickedAt + 10_000
    for (;;) {
      if ((document.querySelector('#run-status')?.textContent ?? '').includes('cancelled')) {
        const status = await chrome.runtime.sendMessage({ type: 'run.status' })
        return { latency: Date.now() - clickedAt, committedAtCancel: status?.report?.counters?.uniqueValidProducts ?? null }
      }
      if (Date.now() > deadline) return { latency: Date.now() - clickedAt, committedAtCancel: null }
      await new Promise((r) => setTimeout(r, 25))
    }
  })

  console.log(`[วัดจริง] cancel latency = ${String(measured.latency)} ms`)
  expect(measured.latency).toBeLessThanOrEqual(2000)

  // หลังเข้าสู่ cancelled แล้ว จำนวนที่ commit ต้องไม่เพิ่มอีก (ไม่มี late commit)
  const settled = await page.evaluate(async () => {
    const first = await chrome.runtime.sendMessage({ type: 'run.status' })
    await new Promise((r) => setTimeout(r, 2000))
    const second = await chrome.runtime.sendMessage({ type: 'run.status' })
    return {
      a: first?.resume?.productCount ?? first?.report?.counters?.uniqueValidProducts ?? 0,
      b: second?.resume?.productCount ?? second?.report?.counters?.uniqueValidProducts ?? 0,
    }
  })
  expect(settled.b).toBe(settled.a)
})
