/**
 * Flow image bot — โปรเซสแยกจาก Next.js คุยกันผ่านตาราง FlowJob/FlowWorkerState เท่านั้น
 * รัน: npm run flow-worker (หรือ flow-worker.bat) · หยุด: flow-worker-stop.bat (สร้างไฟล์ .flow-worker.stop
 * แล้ว worker จะจบหลังงานปัจจุบันเสร็จ — ไม่ฆ่ากลางคลิก)
 */
import "dotenv/config";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  ERROR_KIND_LABELS, FLOW_STATUS, WORKER_STATE_ID, candidateFilename, queuedStatus, reviewStatus, runningStatus,
  type FlowRound,
} from "@/lib/flow-jobs";
import { loadWorkerConfig, type WorkerConfig } from "./config";
import { hasSignInButton, launchFlowBrowser, openFlowAndSettle } from "./browser";
import { notify } from "./notify";
import { selectorSetForHost, type SelectorSet } from "./flow-selectors";
import { runRound } from "./flow-driver";
import { StepLog, captureFailure } from "./failure";
import { FlowStepError, isFlowStepError, type ErrorKind } from "./errors";
import { randInt, sleepMs } from "./humanize";
import { isWithinActiveHours, localDateKey, msUntilActiveWindow, pickLongBreakTarget } from "./schedule";
import type { Page } from "playwright";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const STOP_FILE = path.join(process.cwd(), ".flow-worker.stop");
const SLEEP_CHUNK_MS = 20_000;
/** ภาพจุดเช็กของงาน (uploads/<entryId>/flow/checkpoints/) เก็บไว้กี่วัน — หลักฐานตอนพังเก็บถาวรแยกกันเหมือนเดิม */
const CHECKPOINT_KEEP_DAYS = 14;

/** ลบภาพจุดเช็กเก่าเกิน CHECKPOINT_KEEP_DAYS — แตะแค่ไฟล์ในโฟลเดอร์ checkpoints/ เท่านั้น ห้ามพังการเปิดบอท */
function sweepOldCheckpoints(): void {
  const cutoff = Date.now() - CHECKPOINT_KEEP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    for (const entry of readdirSync(UPLOAD_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const dir = path.join(UPLOAD_ROOT, entry.name, "flow", "checkpoints");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        const file = path.join(dir, f);
        if (f.endsWith(".jpg") && statSync(file).mtimeMs < cutoff) {
          unlinkSync(file);
          removed++;
        }
      }
    }
  } catch (e) {
    log(`ลบภาพจุดเช็กเก่าไม่สำเร็จ (ไม่กระทบงาน): ${String(e)}`);
  }
  if (removed > 0) log(`ลบภาพจุดเช็กเก่ากว่า ${CHECKPOINT_KEEP_DAYS} วัน ${removed} ไฟล์`);
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()}  ${msg}`);
}

async function upsertState(data: Record<string, unknown>) {
  await prisma.flowWorkerState.upsert({
    where: { id: WORKER_STATE_ID },
    create: { id: WORKER_STATE_ID, ...data },
    update: data,
  });
}

async function readState() {
  return prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } });
}

function stopRequested(): boolean {
  return existsSync(STOP_FILE);
}

/** นอนเป็นช่วงสั้นๆ เพื่อให้ heartbeat/ตรวจ stop/ตรวจ pause ยังทำงานระหว่างพักยาว */
async function sleepUntil(target: number): Promise<void> {
  while (Date.now() < target) {
    if (stopRequested()) return;
    await sleepMs(Math.min(SLEEP_CHUNK_MS, target - Date.now()));
  }
}

async function pauseWorker(reason: ErrorKind): Promise<void> {
  await upsertState({ pausedReason: reason, pausedAt: new Date(), currentJobId: null, nextWakeAt: null });
  notify("บอท Flow หยุดแล้ว", ERROR_KIND_LABELS[reason] ?? reason);
}

/**
 * บันทึกว่างานนี้พังทันที — ใช้เฉพาะจุดที่ไม่มี page ให้ captureFailure เก็บหลักฐานได้
 * (claimNextJob เท่านั้น) ไม่ throw ต่อถ้าตัว update เองพังซ้อน กันพังซ้อนพังกลบสาเหตุจริง
 */
async function markJobFailedImmediately(jobId: string, e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  await prisma.flowJob
    .update({
      where: { id: jobId },
      data: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: message.slice(0, 2000) },
    })
    .catch((err) => log(`บันทึกงานพังไม่สำเร็จ (${jobId}): ${String(err)}`));
}

/** หยิบงาน: รอบ 2 ก่อน (คนรออยู่) แล้วค่อยรอบ 1 เรียงตามเวลาเข้าคิว — claim ด้วย updateMany กันหยิบซ้ำ */
async function claimNextJob() {
  for (const round of [2, 1] as FlowRound[]) {
    const candidate = await prisma.flowJob.findFirst({
      where: { status: queuedStatus(round) },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) continue;
    const claimed = await prisma.flowJob.updateMany({
      where: { id: candidate.id, status: queuedStatus(round) },
      data: { status: runningStatus(round), startedAt: new Date(), failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
    });
    if (claimed.count === 1) {
      try {
        return await prisma.flowJob.findUniqueOrThrow({ where: { id: candidate.id }, include: { entry: true, images: true } });
      } catch (e) {
        // claim สำเร็จ (running_*) แล้ว แต่ดึงรายละเอียดกลับไม่ได้ — บันทึกว่าพังทันที ไม่ปล่อยค้าง
        // running_* จนกว่า worker รอบหน้าจะมาเจอตอน stale sweep แล้วโยนต่อให้ main() หยุดคิวเหมือนเดิม
        await markJobFailedImmediately(candidate.id, e);
        throw e;
      }
    }
  }
  return null;
}

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimNextJob>>>;

function referencePathFor(job: ClaimedJob): string {
  const dir = path.join(UPLOAD_ROOT, job.entryId, "flow");
  if (job.round === 1) {
    const src = job.images.filter((i) => i.kind === "source").sort((a, b) => a.index - b.index)[0];
    if (!src) throw new FlowStepError("open-flow", "worker_crash", "งานนี้ไม่มีรูปแคปต้นทาง");
    return path.join(dir, src.filename);
  }
  const chosen = job.images.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen);
  if (!chosen) throw new FlowStepError("open-flow", "worker_crash", "งานนี้ยังไม่ได้เลือกรูปรอบ 1");
  return path.join(dir, chosen.filename);
}

async function processJob(page: Page, job: ClaimedJob, cfg: WorkerConfig, sel: SelectorSet, lastBatchAt: number): Promise<boolean> {
  const round = (job.round === 2 ? 2 : 1) as FlowRound;
  const outDir = path.join(UPLOAD_ROOT, job.entryId, "flow");
  const stepLog = new StepLog(true);

  try {
    // ย้าย mkdirSync/upsertState/log เข้ามาใน try ด้วย — ถ้าตัวใดตัวหนึ่งพัง (เช่น
    // upsertState ชน SQLITE_BUSY เพราะแอป Next.js ใช้ dev.db ไฟล์เดียวกัน) ต้องให้ catch
    // ด้านล่างบันทึกงานนี้เป็น failed ทันที ไม่ปล่อยค้าง running_* จนกว่า worker รอบหน้า
    // จะมาเจอตอน stale sweep
    mkdirSync(outDir, { recursive: true });
    const checkpointDir = path.join(outDir, "checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    await upsertState({ currentJobId: job.id, nextWakeAt: null });
    log(`เริ่มงาน ${job.id} (${job.entry.productName}) รอบ ${round} attempt ${job.attempt}`);

    const result = await runRound(
      page,
      {
        round,
        productName: job.entry.productName,
        referencePath: referencePathFor(job),
        outDir,
        filePrefix: `r${round}-a${job.attempt}`,
        // ถ้า spike (Task 5) พบว่ารอบ 2 เปิด project เดิมไม่ได้ ให้เปลี่ยนบรรทัดนี้เป็น null เสมอ
        projectId: job.flowProjectId || null,
        extraPrompt: job.extraPrompt,
        checkpointDir,
      },
      cfg,
      sel,
      stepLog,
      // hook ทดสอบ fail-fast (S4) — ไม่ตั้ง env = ไม่มีผล
      { forceFailStep: process.env.FLOW_FORCE_FAIL_STEP }
    );

    await prisma.$transaction(async (tx) => {
      for (const [index, file] of result.files.entries()) {
        const ext = path.extname(file).slice(1) === "jpg" ? "jpg" : "png";
        await tx.flowJobImage.create({
          data: {
            jobId: job.id,
            kind: "candidate",
            round,
            attempt: job.attempt,
            index,
            filename: candidateFilename(round, job.attempt, index, ext),
            mimeType: ext === "jpg" ? "image/jpeg" : "image/png",
            promptExtra: job.extraPrompt,
          },
        });
      }
      await tx.flowJob.update({
        where: { id: job.id },
        data: { status: reviewStatus(round), flowProjectId: result.projectId },
      });
    });
    log(`งาน ${job.id} รอบ ${round} เสร็จ → รอผู้ใช้เลือก`);
    notify("รูปพร้อมให้เลือก", `${job.entry.productName} · รอบ ${round}`);
    return true;
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind: ErrorKind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    const state = await readState();
    const failureDirAbs = path.join(UPLOAD_ROOT, "_flow-failures", `${job.id}-${Date.now()}`);
    await captureFailure({
      page, dir: failureDirAbs, step, kind, message, log: stepLog,
      state: {
        jobId: job.id, round, attempt: job.attempt,
        todayBatches: state?.todayBatches ?? 0,
        sessionStreak: state?.sessionStreak ?? 0,
        msSinceLastBatch: lastBatchAt > 0 ? Date.now() - lastBatchAt : null,
      },
    });
    await prisma.flowJob.update({
      where: { id: job.id },
      data: {
        status: FLOW_STATUS.FAILED, failedStep: step, errorKind: kind, errorMessage: message.slice(0, 2000),
        failureDir: path.relative(process.cwd(), failureDirAbs).split(path.sep).join("/"),
      },
    });
    await pauseWorker(kind);
    log(`งาน ${job.id} พังที่ ${step} (${kind}) — หยุดทั้งคิว หลักฐาน: ${failureDirAbs}`);
    return false;
  }
}

async function main() {
  const cfg = loadWorkerConfig();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);

  // เปิด Chrome ก่อนแตะ DB เสมอ — โปรไฟล์ .flow-profile เปิดได้ทีละโปรเซส จึงใช้เป็นตัวกันบอทซ้อน
  // (start.bat เปิดบอทให้ทุกครั้ง แม้มีตัวหนึ่งรันอยู่แล้ว) ถ้าเปิดไม่ได้ = มีบอทอีกตัวถือโปรไฟล์อยู่
  // หรือหน้าต่าง Flow Login ยังไม่ปิด → ออกเงียบๆ ห้ามทำ stale sweep ข้างล่าง (จะไปทำให้งานที่บอท
  // ตัวจริงกำลังวาดอยู่กลายเป็น failed) และห้าม pause คิว
  let launched: Awaited<ReturnType<typeof launchFlowBrowser>>;
  try {
    launched = await launchFlowBrowser(cfg);
  } catch (e) {
    log(`เปิด Chrome ของบอทไม่ได้ — มีบอทตัวอื่นทำงานอยู่แล้ว หรือหน้าต่าง Flow Login ยังเปิดค้าง (ไม่แตะคิว): ${String(e).split("\n")[0]}`);
    process.exit(0);
  }
  const { context, page } = launched;

  // หน้าต่าง Chrome ของบอทถูกปิดโดยไม่ได้ตั้งใจ (ส่วนใหญ่คือคนกดปิดเพราะไม่รู้ว่าเป็นของบอท — เจอจริง
  // 2026-09-29 ตอนบอทเพิ่งเปิดเองหลังเข้า Windows) → ออกทันทีโดยไม่หยุดคิว เดิมไหลไปเป็น worker_crash
  // แล้ว pause ค้างโดยไม่มีงานพังให้กด "รันต่อ" · ทุกจุดที่ปิด browser เองต้องตั้ง closingOnPurpose ก่อน
  let closingOnPurpose = false;
  context.on("close", () => {
    if (closingOnPurpose) return;
    log("หน้าต่าง Chrome ของบอทถูกปิด — ปิดบอท (ไม่ได้หยุดคิว) เปิด start.bat ใหม่เพื่อให้ทำงานต่อ");
    notify("บอท Flow ปิดตัวแล้ว", "หน้าต่าง Chrome ของบอทถูกปิด — เปิด start.bat ใหม่ (อย่าปิดหน้าต่างนั้น ย้ายไปไว้ข้างหลังได้)");
    process.exit(0);
  });
  async function closeBrowser(): Promise<void> {
    closingOnPurpose = true;
    await context.close();
  }

  // งานที่ค้าง running_* = worker รอบก่อนตายกลางคัน → พัง ไม่ reset เป็น queued เอง (กัน loop)
  // หลังเปิด Chrome สำเร็จเท่านั้น (ตัวที่สองที่เปิดซ้อนออกไปก่อนถึงตรงนี้) — แค่ลบไฟล์ ไม่แตะ DB
  sweepOldCheckpoints();

  const stale = await prisma.flowJob.updateMany({
    where: { status: { in: [FLOW_STATUS.RUNNING_R1, FLOW_STATUS.RUNNING_R2] } },
    data: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: "worker ตายกลางคันในรอบก่อน" },
  });
  if (stale.count > 0) {
    await pauseWorker("worker_crash");
    log(`พบงานค้าง running ${stale.count} งาน → failed + หยุดคิว รอผู้ใช้กดรันต่อ`);
  }

  await upsertState({ lastSeenAt: new Date(), currentJobId: null });
  const heartbeat = setInterval(() => {
    upsertState({ lastSeenAt: new Date() }).catch((e) => log(`heartbeat ล้มเหลว: ${String(e)}`));
  }, cfg.heartbeatMs);

  async function pauseAndExit(reason: ErrorKind, message: string, code: number): Promise<never> {
    await pauseWorker(reason);
    log(message);
    clearInterval(heartbeat);
    await closeBrowser();
    process.exit(code);
  }

  // ตอนเพิ่งเข้า Windows (start.bat silent จาก Startup) เน็ตมักยังไม่ต่อ — goto พังด้วย net::ERR_*
  // ซึ่งยังไม่ได้แตะ Google เลย จึงรอแล้วลองใหม่ได้โดยไม่ขัดกฎ "ไม่ retry กับหน้าที่พัง" · ถ้าครบแล้ว
  // ยังไม่มีเน็ต ให้ออกเฉยๆ ไม่ pause คิว (ไม่ใช่ความผิดของงานไหน และไม่มีงานพังให้กด "รันต่อ")
  // error อื่นหยุดทันทีเหมือนเดิม
  const NET_RETRY_MS = 30_000;
  const NET_MAX_TRIES = 10;
  let host = "";
  for (let attempt = 1; ; attempt++) {
    try {
      ({ host } = await openFlowAndSettle(page, cfg));
      break;
    } catch (e) {
      if (!String(e).includes("net::ERR_")) {
        return pauseAndExit("host_unsupported", `เปิด Flow ไม่ได้: ${String(e)}`, 1);
      }
      if (attempt >= NET_MAX_TRIES || stopRequested()) {
        log(`ต่อเน็ตไม่ได้ครบ ${attempt} ครั้ง — ปิดบอท (ไม่ได้หยุดคิว) เปิด start.bat ใหม่เมื่อเน็ตมา`);
        notify("บอท Flow ปิดตัวแล้ว", "ต่อเน็ตไม่ได้ — เปิด start.bat ใหม่เมื่อเน็ตมา");
        clearInterval(heartbeat);
        await closeBrowser();
        process.exit(0);
      }
      log(`ยังต่อเน็ตไม่ได้ (${attempt}/${NET_MAX_TRIES}) — รอ ${NET_RETRY_MS / 1000} วิแล้วลองใหม่`);
      await sleepMs(NET_RETRY_MS);
    }
  }
  // เช็ก login ก่อน selectorSetForHost — หน้า login ของ Google ไม่ใช่โฮสต์ที่รู้จัก ถ้าเช็กทีหลังจะถูก
  // รายงานผิดเป็น host_unsupported (ตรรกะเดียวกับ assertPageUsable ใน flow-driver.ts) · ปิดตัวเอง
  // เพื่อคืนโปรไฟล์ เพราะ Flow Login ต้องเปิดโปรไฟล์เดียวกันด้วย Chrome จริง (ดู flow-login.bat)
  if (host.includes("accounts.google.com") || (await hasSignInButton(page))) {
    return pauseAndExit("login_required", "session หลุด — หยุดคิวแล้วปิดบอท รอ login ใหม่ด้วย flow-login.bat", 0);
  }
  let sel: SelectorSet;
  try {
    sel = selectorSetForHost(host);
  } catch (e) {
    return pauseAndExit("host_unsupported", `เปิด Flow ไม่ได้: ${String(e)}`, 1);
  }
  log(`เปิด Flow แล้ว host=${host} selectorSet=${sel.name}`);

  // มาถึงตรงนี้ = session ใช้ได้ ถ้ารอบก่อนหยุดเพราะ session หลุด แปลว่าผู้ใช้ login ใหม่แล้ว
  // (การเปิดบอทใหม่คือการกระทำของคน ไม่ใช่บอท retry เอง) → ปลดการหยุด และคืนงานที่พังเพราะ
  // login_required กลับเข้าคิวรอบเดิม แบบเดียวกับกด "รันต่อ" (resumeFlowWorker ใน app/actions.ts)
  const pausedReason = (await readState())?.pausedReason ?? "";
  if (pausedReason === "login_required") {
    for (const round of [1, 2] as FlowRound[]) {
      await prisma.flowJob.updateMany({
        where: { status: FLOW_STATUS.FAILED, errorKind: "login_required", round },
        data: { status: queuedStatus(round), failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
      });
    }
    await upsertState({ pausedReason: "", pausedAt: null });
    log("session กลับมาใช้ได้แล้ว — ปลดการหยุดและคืนงานที่ค้างเพราะ login เข้าคิว");
  } else if (pausedReason !== "" && (await prisma.flowJob.count({ where: { status: FLOW_STATUS.FAILED } })) === 0) {
    // หยุดค้างอยู่แต่ไม่มีงานที่พังเลย = ทางตันในหน้า /flow (ปุ่ม "รันต่อ"/"ข้าม" อยู่บนงานที่พังเท่านั้น)
    // เช่นรอบก่อนล้มระหว่างเปิดตัว · การเปิดบอทใหม่คือการกู้คืนของคน จึงปลดให้ ส่วนการหยุดที่มีงานพัง
    // (รวม stale sweep ข้างบน) ยังต้องให้คนกด "รันต่อ" เหมือนเดิม
    await upsertState({ pausedReason: "", pausedAt: null });
    log(`ปลดการหยุด (${pausedReason}) ที่ค้างจากรอบก่อน — ไม่มีงานที่พังให้กดรันต่อ`);
  }

  let longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
  let lastBatchAt = 0;

  while (!stopRequested()) {
    const state = await readState();
    const now = new Date();

    if (state?.pausedReason) {
      await sleepMs(cfg.pollIdleMs);
      continue;
    }
    if (state?.todayDate !== localDateKey(now)) {
      await upsertState({ todayDate: localDateKey(now), todayBatches: 0 });
      continue;
    }
    if (!isWithinActiveHours(now, cfg.activeHours)) {
      const wake = Date.now() + msUntilActiveWindow(now, cfg.activeHours as [string, string]);
      await upsertState({ nextWakeAt: new Date(wake) });
      await sleepUntil(Math.min(wake, Date.now() + 5 * 60_000));
      continue;
    }
    if ((state?.todayBatches ?? 0) >= cfg.dailyBatchCap) {
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      await upsertState({ nextWakeAt: midnight });
      await sleepUntil(Math.min(midnight.getTime(), Date.now() + 5 * 60_000));
      continue;
    }
    if ((state?.sessionStreak ?? 0) >= longBreakTarget) {
      const ms = randInt(cfg.longBreakMs);
      log(`พักยาว ${Math.round(ms / 60000)} นาที`);
      await upsertState({ nextWakeAt: new Date(Date.now() + ms), sessionStreak: 0 });
      await sleepUntil(Date.now() + ms);
      longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
      continue;
    }

    const job = await claimNextJob();
    if (!job) {
      await upsertState({ nextWakeAt: null });
      await sleepMs(cfg.pollIdleMs);
      continue;
    }

    const ok = await processJob(page, job, cfg, sel, lastBatchAt);
    if (!ok) {
      // session หลุดกลางคิว → ปิดบอทเพื่อคืนโปรไฟล์ให้ Flow Login (หยุดรออยู่เฉยๆ ก็ login ไม่ได้
      // เพราะโปรไฟล์ถูกบอทถือไว้) พอเปิดบอทใหม่หลัง login ส่วนต้นของ main() จะคืนงานเข้าคิวเอง
      if ((await readState())?.pausedReason === "login_required") {
        log("session หลุดกลางคิว — ปิดบอทเพื่อให้ login ใหม่ได้");
        break;
      }
      continue;
    }

    lastBatchAt = Date.now();
    await prisma.flowWorkerState.update({
      where: { id: WORKER_STATE_ID },
      data: {
        currentJobId: null,
        todayBatches: { increment: 1 },
        // sessionStreak นับ "สินค้า" ไม่ใช่ "รอบ" (1 สินค้า = รอบ 1 + รอบ 2) จึงบวกเฉพาะตอน
        // รอบ 2 จบ = สินค้านั้นเสร็จจริง — ถ้าบวกทุกรอบ longBreakEvery [4,6] จะกลายเป็น
        // พักยาวทุก 2-3 สินค้า ผิดจากที่สเปกกับ CLAUDE.md เขียนไว้
        // ผลข้างเคียงที่ยอมรับ: สินค้าที่ผู้ใช้ข้าม/สั่งทำใหม่ตั้งแต่รอบ 1 จะไม่ขยับ streak เลย
        // ช่วงนั้นจึงเหลือ dailyBatchCap + betweenProductsMs เป็นตัวคุมจังหวะแทน
        ...(job.round === 2 ? { sessionStreak: { increment: 1 } } : {}),
      },
    });

    // betweenBatchesMs (config) ไม่ได้ใช้ตรงนี้โดยตั้งใจ — ตอนนี้มีแค่ 1 การส่งต่อสินค้าต่อรอบ
    // จึง betweenProductsMs ก็คุมช่วงพักได้ครบอยู่แล้ว คีย์นี้เตรียมไว้ให้ worker วิดีโอในอนาคต
    const pause = randInt(cfg.betweenProductsMs);
    await upsertState({ nextWakeAt: new Date(Date.now() + pause) });
    await sleepUntil(Date.now() + pause);
  }

  log("ออกจาก loop หลัก — ปิด browser");
  clearInterval(heartbeat);
  await upsertState({ currentJobId: null, nextWakeAt: null });
  await closeBrowser();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);
}

main().catch(async (e) => {
  const detail = e instanceof Error ? e.stack ?? e.message : String(e);
  log(`worker ล้ม: ${detail}`);
  // browser ถูกปิดแล้ว error จากคำสั่งที่ค้างอยู่อาจมาถึงก่อน event "close" ของ context — กรณีเดียวกับ
  // handler ใน main() จึงไม่หยุดคิวเช่นกัน
  if (detail.includes("has been closed")) process.exit(0);
  await pauseWorker("worker_crash").catch(() => undefined);
  process.exit(1);
});
