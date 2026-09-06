import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { ErrorKind } from "./errors";

/** บันทึกเวลาต่อขั้น — ทั้งไว้เขียน steps.log ตอนพัง และไว้พิมพ์ระหว่าง smoke */
export class StepLog {
  private readonly rows: string[] = [];
  constructor(private readonly echo: boolean = true) {}
  log(step: string, msg: string): void {
    const line = `${new Date().toISOString()}\t${step}\t${msg}`;
    this.rows.push(line);
    if (this.echo) console.log(line);
  }
  lines(): string[] {
    return [...this.rows];
  }
}

/**
 * เก็บหลักฐานตอนพังลงโฟลเดอร์เดียว: screenshot.png · page.html · steps.log · state.json
 * state.json คือของที่ได้จากการเอาบัญชีสำรองมาเสี่ยง — ทำไปกี่ชุดแล้วถึงเจอสัญญาณ
 * ฟังก์ชันนี้ห้าม throw (พังซ้อนพังจะกลบสาเหตุจริง) — ล้มขั้นไหนก็ข้ามขั้นนั้น
 */
export async function captureFailure(args: {
  page: Page;
  dir: string;
  step: string;
  kind: ErrorKind;
  message: string;
  log: StepLog;
  state: Record<string, unknown>;
}): Promise<void> {
  const { page, dir, step, kind, message, log, state } = args;
  mkdirSync(dir, { recursive: true });
  try {
    await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true, timeout: 15_000 });
  } catch (e) {
    log.log("capture", `screenshot ล้มเหลว: ${String(e)}`);
  }
  try {
    writeFileSync(path.join(dir, "page.html"), await page.content(), "utf8");
  } catch (e) {
    log.log("capture", `page.html ล้มเหลว: ${String(e)}`);
  }
  try {
    writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ step, kind, message, url: page.url(), capturedAt: new Date().toISOString(), ...state }, null, 2),
      "utf8"
    );
  } catch (e) {
    log.log("capture", `state.json ล้มเหลว: ${String(e)}`);
  }
  writeFileSync(path.join(dir, "steps.log"), log.lines().join("\n") + "\n", "utf8");
}
