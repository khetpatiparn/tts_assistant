/**
 * DL-SPY: สอดแนมว่ากด "1080p Upscaled" ในเมนูโหลดของ Flow แล้วเกิดอะไรขึ้นจริง (ไม่เสียเครดิต)
 * เปิดโปรเจกต์เดิม → hover ช่องคลิป → เมนู ⋯ → ชี้ Download → เลื่อนเมาส์เส้นตรงเข้าเมนูย่อย → คลิกตัวเลือก
 * แล้วบันทึกทุกอย่าง 3 นาที: ทุก response (URL/status/ชนิด/ขนาด), event download, ช่องใหม่ในกริด, screenshot ทุก 10 วิ
 * รัน (ต้องปิดบอทก่อน — โปรไฟล์ Chrome เปิดได้ทีละตัว): npm run flow-smoke:dl -- <projectId> [tileIndex] [qualityRegex...]
 * ผลลัพธ์: worker/smoke/out/dl-spy/ (report.json · responses.jsonl · submenu.html · *.jpg · ไฟล์ที่โหลดได้)
 */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { loadWorkerConfig } from "../config";
import { launchFlowBrowser } from "../browser";
import { selectorSetForHost } from "../flow-selectors";
import { humanHover, humanClick, sleepMs, randInt } from "../humanize";
import { pickDirectVideoUrl } from "../flow-signals";

const OBSERVE_MS = 180_000;
const SHOT_EVERY_MS = 10_000;

async function main() {
  const [projectId, tileArg, ...qualityArgs] = process.argv.slice(2);
  if (!projectId) {
    console.error("usage: npm run flow-smoke:dl -- <projectId> [tileIndex] [qualityRegex...]");
    process.exit(2);
  }
  const tileIndex = tileArg ? Number(tileArg) : 0;
  const quality = qualityArgs.length > 0 ? qualityArgs.map((q) => new RegExp(q)) : [/1080p/, /Upscaled/];
  const cfg = loadWorkerConfig();
  const out = path.resolve("worker/smoke/out/dl-spy");
  mkdirSync(out, { recursive: true });
  const responsesFile = path.join(out, "responses.jsonl");
  writeFileSync(responsesFile, "");
  const t0 = Date.now();
  const note = (msg: string) => {
    const line = `${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s  ${msg}`;
    console.log(line);
    appendFileSync(path.join(out, "notes.log"), line + "\n");
  };
  const shot = (name: string, page: Page) => page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 50 }).catch(() => {});

  const { context, page } = await launchFlowBrowser(cfg);
  const downloads: { at: number; url: string; suggested: string; saved: string | null; failure: string | null }[] = [];
  let clickedAt = 0;
  const attach = (p: Page, label: string) => {
    p.on("response", (res) => {
      const h = res.headers();
      appendFileSync(
        responsesFile,
        JSON.stringify({
          t: Date.now() - t0, page: label, url: res.url().slice(0, 300), status: res.status(),
          ct: h["content-type"] ?? "", len: h["content-length"] ?? "", afterClick: clickedAt > 0,
        }) + "\n",
      );
    });
    p.on("download", (d) => {
      const rec = { at: Date.now() - t0, url: d.url().slice(0, 300), suggested: d.suggestedFilename(), saved: null as string | null, failure: null as string | null };
      downloads.push(rec);
      note(`DOWNLOAD event: ${rec.suggested} ${rec.url}`);
      const file = path.join(out, `dl-${downloads.length}-${rec.suggested || "file"}`);
      d.saveAs(file).then(() => { rec.saved = file; note(`saved ${file}`); }).catch((e: unknown) => { rec.failure = String(e); note(`saveAs failed ${String(e)}`); });
    });
  };
  attach(page, "main");
  context.on("page", (p) => { note(`NEW TAB opened: ${p.url()}`); attach(p, "tab"); });

  try {
    const url = `https://flow.google.com/project/${projectId}?hl=en`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleepMs(6_000);
    const host = new URL(page.url()).host;
    const sel = selectorSetForHost(host);
    const v = sel.video;
    if (!v) throw new Error(`host ${host} ไม่มี selector วิดีโอ`);
    note(`opened ${page.url()}`);
    await shot("0-project", page);

    const containers = page.locator(v.tileContainer);
    const tilesBefore = await containers.count();
    const thumbsBefore = await containers.evaluateAll((els, thumb) => els.map((el) => el.querySelector(thumb)?.getAttribute("src") ?? ""), v.tileThumbnail);
    note(`video tiles: ${String(tilesBefore)}`);
    if (tilesBefore <= tileIndex) throw new Error(`ไม่มีช่องที่ ${String(tileIndex)}`);
    const container = containers.nth(tileIndex);
    await container.scrollIntoViewIfNeeded();
    await humanHover(page, container.locator(v.tile).first(), cfg);
    await sleepMs(1500);
    const srcsBefore = await container.locator(v.tileVideo).evaluateAll((els) => els.map((e) => (e as HTMLVideoElement).currentSrc || e.getAttribute("src")));
    note(`direct url before: ${pickDirectVideoUrl(srcsBefore) ?? "(none)"}`);

    const more = container.locator(v.moreOptions).first();
    await more.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
    await humanClick(page, more, cfg);
    await sleepMs(800);
    const dl = page.locator(v.downloadMenuItem).first();
    await dl.waitFor({ state: "visible", timeout: cfg.selectorTimeoutMs });
    await shot("1-menu", page);
    const dlBox = await dl.boundingBox();
    if (!dlBox) throw new Error("no Download box");
    const rowY = dlBox.y + dlBox.height / 2;
    await page.mouse.move(dlBox.x + dlBox.width * 0.5, rowY, { steps: 15 });
    await sleepMs(1200);
    const items = await page.locator(v.menuItem).evaluateAll((els) =>
      els.map((e) => ({ text: (e.textContent ?? "").replace(/\s+/g, " ").trim(), disabled: e.getAttribute("aria-disabled") === "true" || (e as HTMLButtonElement).disabled, visible: (e as HTMLElement).offsetParent !== null })),
    );
    note(`menu items: ${JSON.stringify(items)}`);
    writeFileSync(path.join(out, "submenu.html"), await page.locator(".cdk-overlay-container").evaluate((e) => e.innerHTML).catch(() => "(no overlay container)"));
    await shot("2-submenu", page);
    let target = page.locator(v.menuItem);
    for (const re of quality) target = target.filter({ hasText: re });
    target = target.first();
    await target.waitFor({ state: "visible", timeout: 4000 });
    const tBox = await target.boundingBox();
    if (!tBox) throw new Error("no target box");
    const subX = tBox.x + Math.min(40, tBox.width / 3);
    await page.mouse.move(subX, rowY, { steps: 12 });
    await sleepMs(300);
    await page.mouse.move(subX, tBox.y + tBox.height / 2, { steps: 10 });
    await sleepMs(400);
    await shot("3-hover-target", page);
    note(`target visible=${String(await target.isVisible())} text="${((await target.textContent()) ?? "").trim()}"`);
    // DL_SPY_ABORT=1 = ทดสอบวิธีของบอท: ยกเลิก fetch ไฟล์ฝั่งหน้าเว็บ (กัน Chrome crash ตอนเริ่มดาวน์โหลด) แล้วดึงเอง
    if (process.env.DL_SPY_ABORT === "1") {
      const wantUp = quality.some((re) => re.test("Upscaled"));
      await page.route((u) => pickDirectVideoUrl([u.toString()]) !== null, (route) => {
        const u = route.request().url();
        const type = route.request().resourceType();
        if (/_upsampled(\?|$)/.test(u) === wantUp && (wantUp || type === "fetch" || type === "xhr")) {
          note(`ROUTE abort ${type} ${u.slice(0, 160)}`);
          route.abort("aborted").catch(() => {});
          page.request.get(u, { maxRedirects: 3, timeout: 120_000 }).then(async (r) => {
            const b = await r.body();
            const f = path.join(out, `self-${wantUp ? "1080p" : "720p"}.mp4`);
            writeFileSync(f, b);
            note(`SELF-FETCH ok HTTP ${String(r.status())} ${String(b.length)} bytes → ${f}`);
          }).catch((e: unknown) => note(`SELF-FETCH failed ${String(e)}`));
          return;
        }
        note(`ROUTE continue ${type} ${u.slice(0, 120)}`);
        route.continue().catch(() => {});
      });
    }
    clickedAt = Date.now();
    await page.mouse.down();
    await sleepMs(randInt([60, 140]));
    await page.mouse.up();
    note("CLICKED target");

    // สังเกต 3 นาที
    let lastShot = 0;
    const seenTexts = new Set<string>();
    while (Date.now() - clickedAt < OBSERVE_MS) {
      await sleepMs(2000);
      const el = Date.now() - clickedAt;
      const tilesNow = await containers.count().catch(() => -1);
      const pending = sel.pendingTile ? await page.locator(sel.pendingTile).count().catch(() => -1) : -1;
      const menuOpen = await page.locator(v.menuItem).filter({ visible: true }).count().catch(() => -1);
      const texts = await page.evaluate(() => {
        const found: string[] = [];
        for (const e of Array.from(document.querySelectorAll("[role='alert'],[role='status'],[role='progressbar'],.cdk-overlay-container *,snack-bar-container *,mat-snack-bar-container *"))) {
          const t = (e.textContent ?? "").replace(/\s+/g, " ").trim();
          if (t && t.length < 200 && /upscal|download|1080|processing|prepar|ready|fail|error|%/i.test(t)) found.push(t);
        }
        return Array.from(new Set(found)).slice(0, 20);
      }).catch(() => [] as string[]);
      for (const t of texts) if (!seenTexts.has(t)) { seenTexts.add(t); note(`UI text: "${t}"`); }
      if (el - lastShot >= SHOT_EVERY_MS) { lastShot = el; await shot(`4-after-${String(Math.round(el / 1000)).padStart(3, "0")}s`, page); note(`tiles=${String(tilesNow)} pending=${String(pending)} menuOpen=${String(menuOpen)} url=${page.url()}`); }
      if (tilesNow > tilesBefore) {
        const thumbsNow = await containers.evaluateAll((els, thumb) => els.map((e) => e.querySelector(thumb)?.getAttribute("src") ?? ""), v.tileThumbnail).catch(() => [] as string[]);
        const fresh = thumbsNow.filter((s) => !thumbsBefore.includes(s));
        note(`NEW TILE(S): ${JSON.stringify(fresh)}`);
      }
      if (downloads.length > 0 && downloads.every((d) => d.saved !== null || d.failure !== null) && el > 20_000) { note("download settled — stop observing early"); break; }
    }
    // หลังสังเกต: hover ช่องเดิมอ่านลิงก์ตรงอีกที (เผื่อ upscale เปลี่ยน src)
    await page.keyboard.press("Escape").catch(() => {});
    await sleepMs(500);
    await humanHover(page, container.locator(v.tile).first(), cfg).catch(() => {});
    await sleepMs(2000);
    const srcsAfter = await container.locator(v.tileVideo).evaluateAll((els) => els.map((e) => (e as HTMLVideoElement).currentSrc || e.getAttribute("src"))).catch(() => [] as (string | null)[]);
    note(`direct url after: ${pickDirectVideoUrl(srcsAfter) ?? "(none)"}`);
    await shot("5-end", page);
    writeFileSync(path.join(out, "report.json"), JSON.stringify({ projectId, tileIndex, quality: quality.map(String), tilesBefore, srcsBefore, srcsAfter, downloads, items, uiTexts: Array.from(seenTexts) }, null, 2));
    console.log("DL-SPY DONE — ดู worker/smoke/out/dl-spy/");
  } catch (e) {
    note(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
    await shot("9-failure", page);
    writeFileSync(path.join(out, "page.html"), await page.content().catch(() => ""));
    process.exitCode = 1;
  } finally {
    await sleepMs(1500);
    await context.close();
  }
}

main();
