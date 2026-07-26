/** entry เท่าที่การไต่สายเลือดต้องใช้ */
export type LineageEntry = {
  id: string;
  duplicatedFromId: string | null;
};

/** entry เท่าที่การคัด angle ต้องใช้ */
export type AngleEntry = LineageEntry & {
  angle: string;
  videoUrl: string;
  postedAt: Date | null;
  chatgptOutput: string;
};

export type UsedAngle = {
  entryId: string;
  text: string;
  /** ลงคลิปจริงแล้วหรือยัง — ยังไม่ลงคือ "วางแผนไว้" */
  posted: boolean;
  postedAt: Date | null;
};

export type AngleSuggestion = { text: string; why: string };

export type EntryOutcome = {
  /** null = ยังไม่มีข้อมูลวิว ซึ่งต่างจาก 0 วิว — ห้ามยุบสองอันนี้เป็นค่าเดียวกัน */
  views: number | null;
  orders: number;
  settledRevenue: number;
};

export type RepeatStatus = {
  repeats: number;
  postedRepeats: number;
  lastPostedAt: Date | null;
  hasUnposted: boolean;
};

/**
 * หาสมาชิกทั้งหมดในสายเลือดการทำซ้ำ (ไต่ขึ้นหาต้นฉบับ แล้วแผ่ลงหาลูกหลานทุกชั้น)
 *
 * จัดกลุ่มด้วยสายเลือด ไม่ใช่ชื่อสินค้า — ในข้อมูลจริงมี entry ชื่อ "ที่ลับเล็บแมว"
 * สองอันที่เป็นสินค้าคนละชิ้นกันจริงๆ (ของเล่นไม้ 4-in-1 กับบ้านลับเล็บกระดาษ 2 ชั้น)
 * การจับกลุ่มด้วยชื่อจะเอา angle ของสินค้าอื่นมาปนทันที
 */
export function collectFamily<T extends LineageEntry>(entries: T[], entryId: string): T[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let root = byId.get(entryId);
  if (!root) return [];

  // ไต่ขึ้นหา root — เผื่อพ่อถูกลบไปแล้ว (duplicatedFromId ไม่ใช่ FK) และเผื่อวนลูป
  const climbed = new Set<string>([root.id]);
  while (root.duplicatedFromId !== null) {
    const parent = byId.get(root.duplicatedFromId);
    if (!parent || climbed.has(parent.id)) break;
    climbed.add(parent.id);
    root = parent;
  }

  // แผ่ลงจาก root แบบ BFS
  const family: T[] = [];
  const visited = new Set<string>();
  const queue: T[] = [root];
  while (queue.length > 0) {
    const current = queue.shift() as T;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    family.push(current);
    for (const e of entries) {
      if (e.duplicatedFromId === current.id && !visited.has(e.id)) queue.push(e);
    }
  }
  return family;
}

/**
 * angle ที่ถือว่า "ใช้ไปแล้ว" ในสายเลือดนี้ (ไม่รวม entry ที่กำลังแก้อยู่)
 *
 * ต้องกรอง "ร่างเปล่า" (ยังไม่ลงคลิป + ยังไม่ตั้ง angle) ออก เพราะ duplicatePrompt
 * ก๊อป chatgptOutput ของต้นฉบับมาด้วย (app/actions.ts) — ถ้าไม่กรอง ร่างที่ยังไม่ได้
 * regenerate จะถูกอ่านว่าใช้ angle เดียวกับต้นฉบับ ทำให้รายการซ้ำตัวเองทันที
 */
export function collectUsedAngles(family: AngleEntry[], currentId: string): UsedAngle[] {
  const out: UsedAngle[] = [];
  for (const entry of family) {
    if (entry.id === currentId) continue;
    const posted = entry.videoUrl.trim() !== "";
    const stored = entry.angle.trim();
    if (stored !== "") {
      out.push({ entryId: entry.id, text: stored, posted, postedAt: entry.postedAt });
    } else if (posted) {
      const hints = extractAngleHints(entry.chatgptOutput);
      if (hints !== "") {
        out.push({ entryId: entry.id, text: hints, posted: true, postedAt: entry.postedAt });
      }
    }
    // ร่างเปล่า: ข้ามทิ้ง
  }
  return out;
}

/** เก็บเนื้อหาใต้หัวข้อเลข `heading` จนถึงหัวข้อเลข `next` (ทนการเยื้องบรรทัด) */
function sectionBody(lines: string[], heading: number, next: number): string {
  const headRe = new RegExp(`^\\s*${heading}\\.\\s`);
  const nextRe = new RegExp(`^\\s*${next}\\.\\s`);
  const start = lines.findIndex((line) => headRe.test(line));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => nextRe.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join(" ").replace(/\s+/g, " ").trim();
}

const SCRIPT_MARKER = "Full voice-over script:";

/**
 * สกัด "แนวคลิป" จาก 10-part prompt ของคลิปเก่าที่ทำก่อนมีฟีเจอร์นี้ — เอาหัวข้อ Scene
 * กับบทพากย์มาพอให้รู้ว่าคลิปนั้นเล่ามุมไหน (ไม่ migrate ข้อมูล สกัดสดตอนต้องใช้)
 *
 * ต้องทนการเยื้องบรรทัด: ข้อมูลจริงมีทั้งแบบเยื้อง 3 ช่องและไม่เยื้องเลย
 * สกัดไม่ได้ให้คืน 600 ตัวอักษรแรก ไม่ throw — ข้อมูลคลุมเครือดีกว่าไม่มีเลย
 */
export function extractAngleHints(output: string): string {
  const text = output.replace(/\*\*/g, "");
  if (text.trim() === "") return "";
  const lines = text.split("\n");
  const parts: string[] = [];

  const scene = sectionBody(lines, 2, 3);
  if (scene !== "") parts.push("ฉาก: " + scene);

  const markerIndex = text.indexOf(SCRIPT_MARKER);
  if (markerIndex !== -1) {
    const collected: string[] = [];
    for (const raw of text.slice(markerIndex + SCRIPT_MARKER.length).split("\n")) {
      const line = raw.trim().replace(/^[""]+|[""]+$/g, "");
      if (line === "") {
        if (collected.length > 0) break;
        continue;
      }
      // หยุดเมื่อถึงบรรทัดเวลา (00:00-00:02) ซึ่งเป็นจุดเริ่ม timeline
      if (/^\d{2}:\d{2}/.test(line)) break;
      collected.push(line);
      if (collected.join(" ").length > 300) break;
    }
    if (collected.length > 0) {
      parts.push("บทพูด: " + collected.join(" ").slice(0, 300));
    }
  }

  if (parts.length === 0) return text.trim().slice(0, 600);
  return parts.join(" · ");
}

/**
 * แยกคำตอบของโมเดลเป็นรายการ angle
 * ผิดฟอร์แมตแล้วไม่ throw — คืนทั้งก้อนเป็นตัวเลือกเดียว ผู้ใช้ตัดแปะเองได้
 * ดีกว่าทิ้งผลลัพธ์ที่จ่ายโควตาไปแล้ว (แนวเดียวกับ lib/caption.ts)
 */
export function parseAngleSuggestions(raw: string): AngleSuggestion[] {
  const text = raw.replace(/\*\*/g, "").trim();
  const out: AngleSuggestion[] = [];
  for (const block of text.split(/\n(?=\s*\d+[.)]\s)/)) {
    const body = block.replace(/^\s*\d+[.)]\s*/, "").trim();
    if (body === "") continue;
    const withWhy = body.match(/^([\s\S]*?)\n\s*เพราะ:\s*([\s\S]*)$/);
    if (withWhy) {
      out.push({
        text: withWhy[1].replace(/\s+/g, " ").trim(),
        why: withWhy[2].replace(/\s+/g, " ").trim(),
      });
    } else {
      out.push({ text: body.replace(/\s+/g, " ").trim(), why: "" });
    }
  }
  if (out.length === 0) return [{ text, why: "" }];
  return out;
}

/**
 * ผลลัพธ์จริงของ entry หนึ่ง — แสดงข้างรายการ angle เพื่อให้เห็นว่าแนวนั้นขายได้ไหม
 * settledRevenue ใช้นิยามเดียวกับ summarizeOrders ใน lib/dashboard.ts (ผลรวม finalRevenue)
 * เพื่อไม่ให้ตัวเลขสองที่ในแอปขัดกันเอง
 */
export function summarizeEntryOutcome(args: {
  entryId: string;
  orders: { matchedEntryId: string | null; finalRevenue: number | null }[];
  metrics: { matchedEntryId: string | null; views: number; capturedOn: Date }[];
}): EntryOutcome {
  const { entryId, orders, metrics } = args;
  let orderCount = 0;
  let settledRevenue = 0;
  for (const o of orders) {
    if (o.matchedEntryId !== entryId) continue;
    orderCount++;
    settledRevenue += o.finalRevenue ?? 0;
  }

  let views: number | null = null;
  let latest = -Infinity;
  for (const m of metrics) {
    if (m.matchedEntryId !== entryId) continue;
    const at = m.capturedOn.getTime();
    if (at > latest) {
      latest = at;
      views = m.views;
    }
  }

  return { views, orders: orderCount, settledRevenue };
}

/**
 * สถานะการทำซ้ำของ entry หนึ่ง — นับเฉพาะ "ลูกหลาน" ไม่นับตัวเองและไม่นับต้นฉบับ
 * ใช้เติมบรรทัดสถานะในการ์ดคำแนะนำ แทนการให้ผู้ใช้ติ๊ก checkbox เอง
 * (ปัญหาต้นทางของผู้ใช้คือลืม — ของที่ต้องจำไปติ๊กคือของที่ลืมได้อีกอย่าง)
 */
export function repeatStatus<
  T extends LineageEntry & { videoUrl: string; postedAt: Date | null },
>(entries: T[], entryId: string): RepeatStatus {
  const descendants: T[] = [];
  const visited = new Set<string>([entryId]);
  const queue: string[] = [entryId];
  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    for (const e of entries) {
      if (e.duplicatedFromId !== currentId || visited.has(e.id)) continue;
      visited.add(e.id);
      descendants.push(e);
      queue.push(e.id);
    }
  }

  let postedRepeats = 0;
  let hasUnposted = false;
  let lastPostedAt: Date | null = null;
  for (const e of descendants) {
    if (e.videoUrl.trim() !== "") {
      postedRepeats++;
      if (e.postedAt && (lastPostedAt === null || e.postedAt > lastPostedAt)) {
        lastPostedAt = e.postedAt;
      }
    } else {
      hasUnposted = true;
    }
  }

  return { repeats: descendants.length, postedRepeats, lastPostedAt, hasUnposted };
}
