import type { Locator, Page } from "playwright";
import type { Range, WorkerConfig } from "./config";

/** สุ่มจำนวนเต็มในช่วง [min, max] ทั้งสองปลายรวม */
export function randInt([min, max]: Range): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepRange(range: Range): Promise<void> {
  return sleepMs(randInt(range));
}

export type Point = { x: number; y: number };

/** จุดบนเส้นโค้ง quadratic bezier — export ไว้ให้ทดสอบได้โดยไม่ต้องมี browser */
export function bezierPoints(from: Point, to: Point, control: Point, steps: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y;
    pts.push({ x, y });
  }
  return pts;
}

let lastMouse: Point = { x: 200, y: 200 };

/**
 * เลื่อนเมาส์ไปยังจุดหมายเป็นเส้นโค้งหลายสเต็ป — Playwright ค่าเริ่มต้นวาร์ปเมาส์ทันที
 * ซึ่งต่างจากคนชัดเจน
 */
export async function moveMouseCurve(page: Page, to: Point, from: Point = lastMouse): Promise<void> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control: Point = {
    x: from.x + dx * 0.5 + (Math.random() - 0.5) * Math.abs(dy) * 0.6,
    y: from.y + dy * 0.5 + (Math.random() - 0.5) * Math.abs(dx) * 0.6,
  };
  const steps = randInt([18, 40]);
  for (const p of bezierPoints(from, to, control, steps)) {
    await page.mouse.move(p.x, p.y);
    await sleepMs(randInt([4, 14]));
  }
  lastMouse = to;
}

/**
 * คลิก element แบบคน: หน่วงก่อน → เลื่อนเมาส์โค้งไปจุดสุ่มภายในกล่อง → กด
 * ถ้า element ไม่มี bounding box (ซ่อนอยู่) ให้ตกไปใช้ locator.click() ปกติ เพื่อให้
 * error ที่ได้เป็น timeout ของ Playwright ตามเดิม (ผู้เรียกแปลงเป็น selector_drift เอง)
 */
export async function humanClick(page: Page, locator: Locator, cfg: WorkerConfig): Promise<void> {
  await sleepRange(cfg.actionDelayMs);
  const box = await locator.boundingBox();
  if (box === null || !cfg.mouse.curve) {
    await locator.click({ timeout: cfg.selectorTimeoutMs });
    return;
  }
  const target: Point = {
    x: box.x + box.width * (0.3 + Math.random() * 0.4),
    y: box.y + box.height * (0.3 + Math.random() * 0.4),
  };
  await moveMouseCurve(page, target);
  await sleepMs(randInt([40, 160]));
  await page.mouse.down();
  await sleepMs(randInt([30, 110]));
  await page.mouse.up();
}

/**
 * พิมพ์ทีละตัวอักษรด้วย insertText — ใช้กับ Slate editor ของ Flow ได้ (fill() ใช้ไม่ได้)
 * และรองรับตัวอักษรไทยที่ keyboard.type จับคู่ key ไม่ได้
 */
export async function typeHuman(page: Page, text: string, charDelay: Range): Promise<void> {
  for (const ch of text) {
    await page.keyboard.insertText(ch);
    await sleepMs(randInt(charDelay));
  }
}

/** บางครั้งเลื่อนหน้าขึ้นลงเปล่าๆ เหมือนคนกำลังมอง — ไม่กระทบสถานะอะไรใน Flow */
export async function maybeIdleScroll(page: Page, cfg: WorkerConfig): Promise<void> {
  if (Math.random() >= cfg.mouse.idleScrollChance) return;
  const amount = randInt([120, 480]) * (Math.random() < 0.5 ? -1 : 1);
  await page.mouse.wheel(0, amount);
  await sleepMs(randInt([300, 1200]));
  await page.mouse.wheel(0, -amount);
}
