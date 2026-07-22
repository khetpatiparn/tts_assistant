# Post-Time Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้แอปแสดงความสัมพันธ์ระหว่าง "ชั่วโมงที่โพสต์" กับ "ยอดวิว" จากข้อมูลจริงของช่อง โดยผู้ใช้ไม่ต้องกรอกเวลาเอง

**Architecture:** ถอดเวลาอัปโหลดจาก TikTok video id (snowflake) อัตโนมัติ · ตรวจจับคลิปที่ตั้งเวลาไว้ด้วยการเทียบวันกับไฟล์ Content.csv แล้วตัดออกเพราะเวลาเชื่อไม่ได้ · ติดป้ายที่มาของเวลาทุกคลิปเพื่อให้แยกข้อมูลแม่นออกจากข้อมูลที่กรอกเองได้ · import FollowerActivity.csv มาเป็นชั้นเปรียบเทียบ · วิเคราะห์ด้วย pure function ไม่เรียก LLM

**Tech Stack:** Next.js 16 (custom build, App Router + Server Actions), Prisma 7 + better-sqlite3 adapter, React 19, Recharts 3.9.2, Tailwind v4, Base UI

## Global Constraints

- **ไม่มี test runner** — verify ด้วย `npx tsc --noEmit` + `npm run lint` + สคริปต์ readonly + รันจริง ไม่ใช่ unit test
- **ห้ามรัน `npm run build` ถ้า port 3000 ไม่ว่าง** — เช็ก `netstat -ano | grep ':3000' | grep LISTENING` ก่อนเสมอ ถ้าไม่ว่างคือ server ของผู้ใช้ **ห้าม kill ห้าม build** ให้รายงาน BLOCKED · ใช้ `npx tsc --noEmit` แทนได้ในเกือบทุกกรณี (ไม่เขียน `.next` ไม่ชนกับผู้ใช้)
- **ต้องรันแอปดู UI** ใช้ `NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001` (ก๊อป `cp dev.db dev-test.db` ก่อน) — ห้ามแตะ port 3000 และห้ามใช้ `dev.db` ตัวจริง
- **ห้ามแตะ `PromptEntry.postedAt`** (UTC midnight) และห้ามสลับ `toDateInputValue` / `toLocalDateInputValue` ใน `production-panel.tsx`
- **ห้ามเขียน `dev.db` ด้วย standalone script** — อ่านอย่างเดียว `{readonly: true}` และ `require()` better-sqlite3 ด้วย absolute path เข้า `node_modules` ของ repo
- **runtime LLM ต้องเป็น Gemini free tier เท่านั้น** — ฟีเจอร์นี้ไม่เรียก LLM เลย ห้ามเพิ่ม
- **Recharts อยู่ที่ v3.9.2 — API ต่างจากตัวอย่าง v2 ทั่วไป** ห้ามเดา prop shape เช็ค `node_modules/recharts/types/` จริง และตามแพทเทิร์นใน `components/revenue-charts.tsx`
- **เวลาทุกจุดเป็น 24 ชั่วโมง ห้ามมี AM/PM** — ทั้งช่องกรอก แกนกราฟ (`00:00`–`23:00`) และข้อความสรุป
- **🔴 timezone: เวลาจาก video ID เป็น UTC ต้อง +7 · `Hour` ใน FollowerActivity.csv เป็นเวลาไทยอยู่แล้ว ห้ามแปลงซ้ำ** — ตรวจด้วยข้อมูลจริง: พีค FollowerActivity ต้องอยู่ที่ **20:00** ถ้าได้ 03:00 แปลว่าแปลงเกิน
- UI: ห้าม emoji · ข้อความไทย · design token เดิม (`ink`/`paper`/`marigold`/`rust`/`smoke`/`record`)
- ห้าม `git add -A` / `git add .` — stage เฉพาะไฟล์ที่ระบุ
- branch: `feature/post-time-analysis` (มี spec commit `2ea6ea9` แล้ว)

---

### Task 1: Schema — ฟิลด์ที่มาของเวลา + ตาราง FollowerActivity

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `PromptEntry.postedTimeSource: string | null` · `PromptEntry.isScheduledPost: boolean` · model `FollowerActivity` — ใช้ใน Task 3-5

- [ ] **Step 1: เพิ่มฟิลด์ใน PromptEntry**

ใน `prisma/schema.prisma` model `PromptEntry` มี `postedTimeOfDay String?` อยู่แล้ว — เพิ่ม 2 บรรทัดต่อจากมัน:

```prisma
  postedTimeSource String?
  isScheduledPost  Boolean @default(false)
```

- [ ] **Step 2: เพิ่ม model FollowerActivity ต่อท้ายไฟล์**

```prisma
model FollowerActivity {
  id         String   @id @default(cuid())
  activityOn DateTime
  hour       Int
  active     Int
  importedAt DateTime @default(now())

  @@unique([activityOn, hour])
}
```

- [ ] **Step 3: migration + generate**

เช็ก port 3000 ก่อน (ถ้าไม่ว่าง ให้ทำต่อได้ — prisma migrate ไม่แตะ `.next`) จากนั้น:

Run: `npx prisma migrate dev --name add_post_time_source_and_follower_activity`
Expected: migration ใหม่ใน `prisma/migrations/` เป็น `ALTER TABLE ADD COLUMN` + `CREATE TABLE` เท่านั้น **ถ้า prisma เสนอ reset หรือเตือน data loss ให้หยุดทันที รายงาน BLOCKED**

Run: `npx prisma generate`
Expected: สำเร็จ

- [ ] **Step 4: Verify readonly**

เขียนสคริปต์ scratch (นอก repo) `check-schema.js`:

```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev.db', { readonly: true });
const cols = db.prepare("PRAGMA table_info(PromptEntry)").all().map(c => c.name);
console.log('postedTimeSource:', cols.includes('postedTimeSource'));
console.log('isScheduledPost:', cols.includes('isScheduledPost'));
console.log('FollowerActivity cols:', db.prepare("PRAGMA table_info(FollowerActivity)").all().map(c => c.name).join(', '));
console.log('ข้อมูลเดิม — entries:', db.prepare('SELECT COUNT(*) c FROM PromptEntry').get().c,
  '| orders:', db.prepare('SELECT COUNT(*) c FROM AffiliateOrder').get().c,
  '| ClipMetric:', db.prepare('SELECT COUNT(*) c FROM ClipMetric').get().c);
db.close();
```

Run: `node <scratch>/check-schema.js`
Expected: ฟิลด์ใหม่ครบ · `FollowerActivity` มี `id, activityOn, hour, active, importedAt` · ข้อมูลเดิม 49 entries / 209 orders / 15 ClipMetric ไม่หาย

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: ผ่าน ไม่มี error

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add post-time provenance fields and follower activity table"
```

---

### Task 2: Pure lib — ถอดเวลาจาก video ID + วิเคราะห์

**Files:**
- Create: `lib/video-id-time.ts`
- Create: `lib/post-time.ts`

**Interfaces:**
- Produces:
  - `uploadedAtFromVideoId(videoId: string): Date | null`
  - `thaiHourOf(d: Date): number` · `thaiDateKey(d: Date): string`
  - `type PostTimeClip` · `type FollowerActivityRecord` · `type HourBucket` · `type PostTimeAnalysis`
  - `analyzePostTimes(args): PostTimeAnalysis` — Task 5 เรียก

**ทั้งสองไฟล์เป็น pure function ล้วน** — ไม่ import prisma ไม่เรียก LLM ไม่อ่านนาฬิกาเอง (แบบเดียวกับ `lib/recommender.ts` / `lib/dashboard.ts`)

- [ ] **Step 1: เขียน `lib/video-id-time.ts`**

```ts
/** ชดเชยเวลาไทย (UTC+7) — ผู้ชมส่วนใหญ่เป็นคนไทย จึงวิเคราะห์ตามเวลาไทยเสมอ */
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * TikTok video id เป็น snowflake — 32 บิตบนคือ Unix seconds ของ "เวลาอัปโหลด"
 * ยืนยันกับคลิปจริง 15 ตัว คลาดเคลื่อนจากเวลาโพสต์จริง ~21 วินาที (ไม่มีผลระดับชั่วโมง)
 *
 * ⚠️ นี่คือเวลา "อัปโหลด" ไม่ใช่ "เผยแพร่" — คลิปที่ตั้งเวลาไว้จะได้เวลาผิด
 * (เจอจริง: ที่ลับเล็บแมว อัป 28 มิ.ย. แต่เผยแพร่ 1 ก.ค.) การคัดออกทำใน analyzePostTimes
 */
export function uploadedAtFromVideoId(videoId: string): Date | null {
  if (!/^\d{6,25}$/.test(videoId)) return null;
  const seconds = Number(BigInt(videoId) >> 32n);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = seconds * 1000;
  // TikTok เริ่มมีคลิปปี 2016 — ค่าที่ต่ำกว่านี้แปลว่า id ไม่ใช่ snowflake ที่เราคิด
  if (ms < Date.UTC(2016, 0, 1)) return null;
  return new Date(ms);
}

/** ชั่วโมง 0-23 ตามเวลาไทย */
export function thaiHourOf(d: Date): number {
  return new Date(d.getTime() + THAI_OFFSET_MS).getUTCHours();
}

/** คีย์วันที่ YYYY-MM-DD ตามเวลาไทย — ใช้เทียบกับวันเผยแพร่ที่ได้จาก Content.csv */
export function thaiDateKey(d: Date): string {
  return new Date(d.getTime() + THAI_OFFSET_MS).toISOString().slice(0, 10);
}
```

- [ ] **Step 2: เขียน `lib/post-time.ts`**

```ts
import { thaiHourOf, uploadedAtFromVideoId } from "@/lib/video-id-time";

export type FollowerActivityRecord = {
  activityOn: Date;
  hour: number; // 0-23 เวลาไทยอยู่แล้วจากไฟล์ TikTok — ห้ามแปลง timezone ซ้ำ
  active: number;
};

export type PostTimeClip = {
  entryId: string;
  productName: string;
  videoId: string | null;
  postedTimeOfDay: string | null; // "HH:MM"
  postedTimeSource: string | null; // "derived" | "manual" | null
  isScheduledPost: boolean;
  views: number | null;
};

export type HourBucket = {
  hour: number;
  clipCount: number;
  medianViews: number;
  followersActive: number | null;
};

export type PostTimeAnalysis = {
  buckets: HourBucket[];
  usableClips: number;
  skippedScheduled: number;
  skippedNoViews: number;
  scheduledRatio: number;
  enoughData: boolean;
  clipsNeededForConfidence: number;
  peakPostHours: number[];
  peakFollowerHours: number[];
};

/**
 * ต้องมีคลิปที่ใช้ได้เท่านี้ก่อน ถึงจะเริ่มเชื่อรูปแบบเวลาได้
 * ตอนตั้งค่านี้ช่องมีแค่ 13 คลิปที่ใช้ได้ และวิวถูกครอบงำโดย outlier 2 ตัว
 * → ค่านี้ผูกกับสเกลข้อมูล ต้องทบทวนเมื่อช่องโต (ดูหัวข้อค่าคงที่ใน CLAUDE.md)
 */
const MIN_CLIPS_FOR_CONFIDENCE = 30;

/** สัดส่วนคลิปตั้งเวลาที่เกินแล้วถือว่าข้อมูลเริ่มไม่พอ */
export const SCHEDULED_RATIO_WARN = 0.4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/** "HH:MM" -> ชั่วโมง 0-23 (null ถ้ารูปแบบผิด) */
function hourFromClock(value: string): number | null {
  const m = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : null;
}

export function analyzePostTimes(args: {
  clips: PostTimeClip[];
  followerActivity: FollowerActivityRecord[];
  includeManual: boolean;
}): PostTimeAnalysis {
  const { clips, followerActivity, includeManual } = args;

  // ผู้ติดตามออนไลน์: เฉลี่ยต่อชั่วโมงข้ามวัน — ใช้ hour ดิบ ไม่แปลง timezone
  const followerByHour = new Map<number, number[]>();
  for (const f of followerActivity) {
    const list = followerByHour.get(f.hour);
    if (list) list.push(f.active);
    else followerByHour.set(f.hour, [f.active]);
  }

  const viewsByHour = new Map<number, number[]>();
  let usableClips = 0;
  let skippedScheduled = 0;
  let skippedNoViews = 0;

  for (const c of clips) {
    // คลิปตั้งเวลา: เวลาจาก id คือตอนอัป ไม่ใช่ตอนเผยแพร่ → ใช้ได้เฉพาะเมื่อผู้ใช้กรอกเวลาจริงไว้
    if (c.isScheduledPost) {
      const manualHour =
        includeManual && c.postedTimeSource === "manual" && c.postedTimeOfDay
          ? hourFromClock(c.postedTimeOfDay)
          : null;
      if (manualHour === null) {
        skippedScheduled++;
        continue;
      }
      if (c.views === null) {
        skippedNoViews++;
        continue;
      }
      const list = viewsByHour.get(manualHour);
      if (list) list.push(c.views);
      else viewsByHour.set(manualHour, [c.views]);
      usableClips++;
      continue;
    }

    // คลิปโพสต์สด: ถอดเวลาจาก video id
    const uploadedAt = c.videoId ? uploadedAtFromVideoId(c.videoId) : null;
    if (!uploadedAt) {
      skippedNoViews++;
      continue;
    }
    if (c.views === null) {
      skippedNoViews++;
      continue;
    }
    const hour = thaiHourOf(uploadedAt);
    const list = viewsByHour.get(hour);
    if (list) list.push(c.views);
    else viewsByHour.set(hour, [c.views]);
    usableClips++;
  }

  const buckets: HourBucket[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const views = viewsByHour.get(hour) ?? [];
    const followers = followerByHour.get(hour);
    buckets.push({
      hour,
      clipCount: views.length,
      medianViews: median(views),
      followersActive: followers
        ? Math.round(followers.reduce((a, b) => a + b, 0) / followers.length)
        : null,
    });
  }

  const totalConsidered = usableClips + skippedScheduled;
  const maxClipCount = Math.max(...buckets.map((b) => b.clipCount));
  const maxFollowers = Math.max(...buckets.map((b) => b.followersActive ?? 0));

  return {
    buckets,
    usableClips,
    skippedScheduled,
    skippedNoViews,
    scheduledRatio: totalConsidered > 0 ? skippedScheduled / totalConsidered : 0,
    enoughData: usableClips >= MIN_CLIPS_FOR_CONFIDENCE,
    clipsNeededForConfidence: Math.max(0, MIN_CLIPS_FOR_CONFIDENCE - usableClips),
    peakPostHours:
      maxClipCount > 0
        ? buckets.filter((b) => b.clipCount === maxClipCount).map((b) => b.hour)
        : [],
    peakFollowerHours:
      maxFollowers > 0
        ? buckets.filter((b) => b.followersActive === maxFollowers).map((b) => b.hour)
        : [],
  };
}
```

- [ ] **Step 3: Verify ถอดเวลาจาก ID ด้วยข้อมูลจริง**

เขียนสคริปต์ scratch `check-videoid.js` (replicate ตรรกะ ไม่ import TS):

```js
const ids = {
  '7665015920712060176': '2026-07-21 23:16',  // คลิปกางเกง — TikTok แจ้งว่าโพสต์ 23:16:51
  '7656417754160958737': '2026-06-28 19:11',  // ที่ลับเล็บแมว — อัป 28 มิ.ย. (เผยแพร่จริง 1 ก.ค. = ตั้งเวลา)
};
for (const [id, expect] of Object.entries(ids)) {
  const ms = Number(BigInt(id) >> 32n) * 1000;
  const th = new Date(ms + 7 * 3600 * 1000);
  const got = th.toISOString().slice(0, 10) + ' ' + th.toISOString().slice(11, 16);
  console.log(id, '->', got, got === expect ? 'ตรง' : '<<< ไม่ตรง (คาด ' + expect + ')');
}
```

Run: `node <scratch>/check-videoid.js`
Expected: ทั้งสอง id ขึ้น "ตรง"

- [ ] **Step 4: Verify type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่

- [ ] **Step 5: Commit**

```bash
git add lib/video-id-time.ts lib/post-time.ts
git commit -m "Derive post time from TikTok video ids and analyze it by hour"
```

---

### Task 3: แยก CSV helper + parser + import FollowerActivity

**Files:**
- Create: `lib/csv.ts`
- Modify: `lib/clip-metrics.ts` (ใช้ helper กลางแทนของเดิม)
- Create: `lib/follower-activity.ts`
- Modify: `app/actions.ts` (เพิ่ม `importFollowerActivity`)
- Modify: `app/page.tsx` · `components/prompt-workspace.tsx` · `components/dashboard-panel.tsx` (ช่องอัปโหลดที่ 3)

**Interfaces:**
- Consumes: model `FollowerActivity` (Task 1) · `FollowerActivityRecord` (Task 2)
- Produces: `parseCsvRows(text: string): string[][]` · `parseMonthDayLabel(label: string, reference: Date): Date | null` (จาก `lib/csv.ts`) · `parseFollowerActivityCsv(text, importedAt): FollowerActivityInput[]` · `importFollowerActivity(formData): Promise<FollowerActivityImportSummary>`

**บริบทไฟล์** `creative_data/Followers_rainny0192/FollowerActivity.csv`: CSV มี BOM · ทุก field ครอบ quote · header `"Date","Hour","Active followers"` · 167 แถวข้อมูล = 7 วัน (July 14-20) × 24 ชม. · `Date` ไม่มีปี

- [ ] **Step 1: สร้าง `lib/csv.ts` (ย้ายของเดิมมา ไม่เขียนซ้ำ)**

```ts
/**
 * ไฟล์ export ของ TikTok Studio ครอบทุก field ด้วย double quote และ caption มี comma
 * อยู่ข้างใน — split(",") เฉยๆ จะพัง เขียน parser เองแทนการลง dependency ใหม่
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/**
 * วันที่ในไฟล์ TikTok เป็น "July 21" ไม่มีปี — เดาปีจากวันที่อ้างอิง (วันที่ import)
 * ถ้าวันที่ที่ได้ล้ำอนาคตเกิน 1 วัน แปลว่าเป็นปีก่อน (เช่น import ต้นมกราแต่ไฟล์ลงเดือนธันวา)
 */
export function parseMonthDayLabel(label: string, reference: Date): Date | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (month === undefined) return null;
  const day = Number(m[2]);

  let year = reference.getFullYear();
  let d = new Date(Date.UTC(year, month, day));
  if (d.getTime() - reference.getTime() > 24 * 60 * 60 * 1000) {
    year -= 1;
    d = new Date(Date.UTC(year, month, day));
  }
  return d;
}
```

- [ ] **Step 2: ให้ `lib/clip-metrics.ts` ใช้ helper กลาง**

ใน `lib/clip-metrics.ts` ลบ `parseCsvRows`, `MONTHS`, และ `parseAsOfDate` ออกทั้งหมด แล้วเปลี่ยน import ด้านบนเป็น:

```ts
import { videoIdFromUrl } from "@/lib/affiliate";
import { parseCsvRows, parseMonthDayLabel } from "@/lib/csv";
```

แล้วในฟังก์ชัน `parseContentCsv` เปลี่ยนบรรทัดที่เรียก `parseAsOfDate` เป็น:

```ts
    const capturedOn = parseMonthDayLabel(String(r[COL.time] ?? ""), importedAt);
```

**ห้ามเปลี่ยนพฤติกรรมอื่นของ `parseContentCsv`** — ตรรกะเดิมถูกต้องแล้วและมี test ผ่านมาแล้ว (15 แถว/13 จับคู่)

- [ ] **Step 3: เขียน `lib/follower-activity.ts`**

```ts
import { parseCsvRows, parseMonthDayLabel } from "@/lib/csv";

export type FollowerActivityInput = {
  activityOn: Date;
  hour: number;
  active: number;
};

// ตำแหน่งคอลัมน์ (0-based) ใน FollowerActivity.csv ของ TikTok Studio
const COL = { date: 0, hour: 1, active: 2 } as const;

function num(v: unknown): number {
  const n = parseInt(String(v ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ชั่วโมงในไฟล์นี้เป็นเวลาไทยอยู่แล้ว (TikTok Studio export ตามโซนเวลาบัญชี)
 * → เก็บเลขดิบ ห้ามแปลง timezone ซ้ำ ไม่งั้นกราฟจะเหลื่อมจากเวลาโพสต์ 7 ชั่วโมง
 */
export function parseFollowerActivityCsv(
  text: string,
  importedAt: Date
): FollowerActivityInput[] {
  const rows = parseCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) return [];

  const out: FollowerActivityInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const activityOn = parseMonthDayLabel(String(r[COL.date] ?? ""), importedAt);
    if (!activityOn) continue;
    const hour = num(r[COL.hour]);
    if (hour < 0 || hour > 23) continue;
    out.push({ activityOn, hour, active: num(r[COL.active]) });
  }
  return out;
}
```

- [ ] **Step 4: เพิ่ม `importFollowerActivity` ใน `app/actions.ts`**

เพิ่ม import ที่หัวไฟล์ (ต่อจาก `parseContentCsv`):

```ts
import { parseFollowerActivityCsv } from "@/lib/follower-activity";
```

เพิ่ม action ต่อจาก `importClipMetrics`:

```ts
export type FollowerActivityImportSummary = {
  total: number;
  days: number;
};

export async function importFollowerActivity(
  formData: FormData
): Promise<FollowerActivityImportSummary> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("กรุณาเลือกไฟล์ FollowerActivity (.csv)");
  }

  const text = await file.text();
  const importedAt = new Date();
  let rows;
  try {
    rows = parseFollowerActivityCsv(text, importedAt);
  } catch {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ FollowerActivity (.csv) จาก TikTok Studio");
  }
  if (rows.length === 0) {
    throw new Error("ไม่พบข้อมูลผู้ติดตามในไฟล์");
  }

  // upsert ด้วย (activityOn, hour) — โยนไฟล์เดิมซ้ำได้ ไม่เกิดแถวซ้ำ
  for (const r of rows) {
    await prisma.followerActivity.upsert({
      where: { activityOn_hour: { activityOn: r.activityOn, hour: r.hour } },
      create: r,
      update: { active: r.active, importedAt: new Date() },
    });
  }

  revalidatePath("/");
  return {
    total: rows.length,
    days: new Set(rows.map((r) => r.activityOn.getTime())).size,
  };
}
```

- [ ] **Step 5: ดึงข้อมูลส่งเข้าหน้า**

ใน `app/page.tsx` เพิ่มใน `Promise.all` (เป็นตัวที่ 5):

```ts
    prisma.followerActivity.findMany({ orderBy: [{ activityOn: "asc" }, { hour: "asc" }] }),
```

รับเป็น `followerActivity` แล้วส่งเข้า `<PromptWorkspace followerActivity={followerActivity} />`

ใน `components/prompt-workspace.tsx` เพิ่ม prop `followerActivity: FollowerActivityRecord[]` (import type จาก `@/lib/post-time`) ทั้งใน type และ destructure แล้วส่งต่อ `<DashboardPanel followerActivity={followerActivity} />`

ใน `components/dashboard-panel.tsx` เพิ่ม prop เดียวกัน (รับไว้ก่อน ใช้จริงใน Task 5)

- [ ] **Step 6: เพิ่มช่องอัปโหลดที่ 3 ใน `components/dashboard-panel.tsx`**

เพิ่ม import:

```ts
import { importFollowerActivity } from "@/app/actions";
import type { FollowerActivityImportSummary } from "@/app/actions";
```

เพิ่ม state ถัดจาก `useActionState` ของ clip metrics:

```ts
  const [followerState, followerAction, isImportingFollowers] = useActionState<
    { summary: FollowerActivityImportSummary | null; error: string | null },
    FormData
  >(
    async (_prev, formData) => {
      try {
        const summary = await importFollowerActivity(formData);
        return { summary, error: null };
      } catch (e) {
        return { summary: null, error: e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ" };
      }
    },
    { summary: null, error: null }
  );
```

เพิ่มฟอร์มต่อจากฟอร์ม Content.csv:

```tsx
      <form action={followerAction} className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
          className="h-auto max-w-xs py-1.5"
          required
        />
        <Button type="submit" size="sm" variant="outline" disabled={isImportingFollowers}>
          <Upload className="size-3.5" />
          {isImportingFollowers ? "กำลังนำเข้า..." : "นำเข้าผู้ติดตามรายชั่วโมง"}
        </Button>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          โหลดจาก TikTok Studio → Analytics → Followers → Download (FollowerActivity.csv)
        </span>
      </form>

      {followerState.error && (
        <p className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-sm text-record">
          {followerState.error}
        </p>
      )}

      {followerState.summary && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          นำเข้า {followerState.summary.total} แถว · {followerState.summary.days} วัน
        </div>
      )}
```

- [ ] **Step 7: Verify type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน

Run: `npm run lint`
Expected: สะอาด (อาจมี warning ว่า `followerActivity` ยังไม่ถูกใช้ใน dashboard-panel — คาดไว้แล้ว จะใช้ใน Task 5)

- [ ] **Step 8: Verify import จริง**

ก๊อป DB สำหรับทดสอบแล้วรัน dev server แยก:

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `localhost:3001` แท็บ Dashboard อัปโหลด `creative_data/Followers_rainny0192/FollowerActivity.csv`
Expected: ขึ้น **"นำเข้า 167 แถว · 7 วัน"**

ตรวจ DB ทดสอบแบบ readonly (ชี้ที่ `dev-test.db` ไม่ใช่ `dev.db`):

```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev-test.db', { readonly: true });
console.log('rows:', db.prepare('SELECT COUNT(*) c FROM FollowerActivity').get().c);
const peak = db.prepare('SELECT hour, AVG(active) a FROM FollowerActivity GROUP BY hour ORDER BY a DESC LIMIT 3').all();
console.log('พีค 3 อันดับ:', peak.map(p => p.hour + ':00 (' + Math.round(p.a) + ')').join(', '));
db.close();
```
Expected: 167 แถว · **พีคอันดับ 1 = 20:00 (~210)** — ถ้าได้ 03:00 แปลว่าแปลง timezone เกิน ให้หยุดแก้

อัปโหลดไฟล์เดิมซ้ำ → Expected: ยังคง 167 แถว (unique constraint ทำงาน)

หยุด dev server ของตัวเองเมื่อเสร็จ

- [ ] **Step 9: Commit**

```bash
git add lib/csv.ts lib/clip-metrics.ts lib/follower-activity.ts app/actions.ts app/page.tsx components/prompt-workspace.tsx components/dashboard-panel.tsx
git commit -m "Import hourly follower activity from TikTok export"
```

---

### Task 4: Toggle โพสต์สด/ตั้งเวลา + cross-check ตอน import

**Files:**
- Modify: `components/production-panel.tsx`
- Modify: `app/actions.ts` (`updateProduction` + cross-check ใน `importClipMetrics`)
- Modify: `components/prompt-workspace.tsx` (ส่ง default ของ toggle)

**Interfaces:**
- Consumes: `PromptEntry.postedTimeSource` / `isScheduledPost` (Task 1) · `uploadedAtFromVideoId`, `thaiDateKey` (Task 2)

- [ ] **Step 1: `updateProduction` รับ toggle + เวลา**

ใน `app/actions.ts` ฟังก์ชัน `updateProduction` — ตรงที่อ่าน `rawPostedTime` อยู่แล้ว ให้เพิ่มการอ่าน toggle ต่อจากนั้น:

```ts
  const isScheduledPost = String(formData.get("isScheduledPost") ?? "") === "true";
```

แล้วเปลี่ยน field ที่เขียนลง `prisma.promptEntry.update` จากเดิมที่มีแค่ `postedTimeOfDay` เป็น:

```ts
      postedTimeOfDay: rawPostedTime === "" ? null : rawPostedTime,
      postedTimeSource: isScheduledPost
        ? rawPostedTime === ""
          ? null
          : "manual"
        : "derived",
      isScheduledPost,
```

- [ ] **Step 2: cross-check ตอน import Content.csv**

ใน `app/actions.ts` เพิ่ม import:

```ts
import { uploadedAtFromVideoId, thaiDateKey } from "@/lib/video-id-time";
import { parseMonthDayLabel } from "@/lib/csv";
```

ในฟังก์ชัน `importClipMetrics` หลัง loop `upsert` เสร็จ (ก่อน `revalidatePath`) เพิ่ม block นี้:

```ts
  // เวลาจาก video id คือ "เวลาอัปโหลด" ถ้าวันเผยแพร่จริงในไฟล์ไม่ตรงกัน แปลว่าคลิปนั้นตั้งเวลาไว้
  // → เวลาที่ถอดได้เชื่อไม่ได้ ต้องทำเครื่องหมายไว้เพื่อให้ analyzePostTimes ตัดออก
  // ทำแบบนี้เพราะระบบต้องไม่พึ่งว่าผู้ใช้ติ๊ก toggle ถูก — ข้อมูลจริงจับได้ทีหลังเสมอ
  for (const m of metrics) {
    const entryId = videoToEntry.get(m.videoId);
    if (!entryId) continue;
    const uploadedAt = uploadedAtFromVideoId(m.videoId);
    if (!uploadedAt) continue;
    const publishedOn = parseMonthDayLabel(m.postedDate, importedAt);
    if (!publishedOn) continue;

    const scheduled = thaiDateKey(uploadedAt) !== publishedOn.toISOString().slice(0, 10);
    if (!scheduled) continue;

    const entry = await prisma.promptEntry.findUnique({
      where: { id: entryId },
      select: { isScheduledPost: true, postedTimeSource: true },
    });
    if (!entry || entry.isScheduledPost) continue;

    await prisma.promptEntry.update({
      where: { id: entryId },
      data: {
        isScheduledPost: true,
        // เวลาที่เคยติดป้ายว่า derived ใช้ไม่ได้แล้ว — ล้างทิ้ง ไม่เก็บของปลอมไว้
        postedTimeSource: entry.postedTimeSource === "manual" ? "manual" : null,
      },
    });
  }
```

- [ ] **Step 3: toggle ใน `components/production-panel.tsx`**

เพิ่ม state ถัดจาก `postedTimeOfDay`:

```ts
  const [isScheduledPost, setIsScheduledPost] = useState(entry.isScheduledPost);
```

แทนที่บล็อก "เวลาที่ลงคลิป" เดิมทั้งบล็อกด้วย:

```tsx
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">วิธีลงคลิป</label>
            <input type="hidden" name="isScheduledPost" value={String(isScheduledPost)} />
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={isScheduledPost ? "outline" : "default"}
                onClick={() => setIsScheduledPost(false)}
              >
                โพสต์สด
              </Button>
              <Button
                type="button"
                size="sm"
                variant={isScheduledPost ? "default" : "outline"}
                onClick={() => setIsScheduledPost(true)}
              >
                ตั้งเวลา
              </Button>
            </div>
            {isScheduledPost ? (
              <>
                <Input
                  name="postedTimeOfDay"
                  type="time"
                  value={postedTimeOfDay}
                  onChange={(e) => setPostedTimeOfDay(e.target.value)}
                />
                <p className="font-mono text-[0.7rem] text-muted-foreground">
                  เวลาที่เผยแพร่จริง (24 ชม.) — ไม่กรอกก็ได้ แต่คลิปนี้จะไม่ถูกนำไปวิเคราะห์
                </p>
              </>
            ) : (
              <>
                <input type="hidden" name="postedTimeOfDay" value="" />
                <p className="font-mono text-[0.7rem] text-muted-foreground">
                  ระบบอ่านเวลาจากลิงก์คลิปให้เอง ไม่ต้องกรอก
                </p>
              </>
            )}
          </div>
```

**ห้ามแตะบล็อก "วันที่ลงคลิป" (`postedAt`) และ helper `toDateInputValue` / `toLocalDateInputValue`**

- [ ] **Step 4: default ของ toggle ตามพฤติกรรมจริง**

ใน `components/prompt-workspace.tsx` เพิ่ม useMemo (วางใกล้ที่คำนวณ `entries`):

```ts
  // default ของ toggle = แบบที่ผู้ใช้ทำบ่อยกว่า ถ้าวันหนึ่งพฤติกรรมพลิก default ก็สลับเอง
  const defaultScheduled = useMemo(() => {
    const posted = prompts.filter((p) => p.videoUrl !== "");
    if (posted.length === 0) return false;
    const scheduled = posted.filter((p) => p.isScheduledPost).length;
    return scheduled > posted.length / 2;
  }, [prompts]);
```

ส่งเข้า `<ProductionPanel defaultScheduled={defaultScheduled} />` และใน `production-panel.tsx` รับ prop นี้ แล้วใช้เป็นค่าเริ่มต้นเมื่อ entry ยังไม่เคยตั้งค่า:

```ts
  const [isScheduledPost, setIsScheduledPost] = useState(
    entry.postedTimeSource === null && !entry.isScheduledPost ? defaultScheduled : entry.isScheduledPost
  );
```

เพิ่ม `postedTimeSource: string | null` และ `isScheduledPost: boolean` ใน type `PromptEntry` ของ `prompt-workspace.tsx`

- [ ] **Step 5: Verify type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน

Run: `npm run lint`
Expected: สะอาด

- [ ] **Step 6: Verify ในแอปจริง**

รัน dev server แยก (`NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`)

- เลือก entry ที่มีคลิป → toggle default ควรเป็น **โพสต์สด** (เพราะ 13/15) → บันทึก → เลือก entry อื่นแล้วกลับมา ค่าคงอยู่
- สลับเป็น **ตั้งเวลา** → ช่องเวลาโผล่ เป็นแบบ 24 ชม. ไม่มี AM/PM → กรอก `20:30` → บันทึก → กลับมาดู ค่าคงอยู่
- import `Content.csv` อีกครั้ง → ตรวจ readonly ว่า **"ที่ลับเล็บแมว" (video 7656417754160958737) ถูกตั้ง `isScheduledPost = 1`** โดยอัตโนมัติ:

```js
const D = require('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/node_modules/better-sqlite3');
const db = new D('C:/Users/patip/Desktop/playground/tts_assistant/pooling/pooling_prompt/dev-test.db', { readonly: true });
for (const r of db.prepare("SELECT productName, isScheduledPost, postedTimeSource FROM PromptEntry WHERE videoUrl LIKE '%7656417754160958737%' OR videoUrl LIKE '%7663000802738457873%'").all()) console.log(r);
db.close();
```
Expected: ที่ลับเล็บแมว `isScheduledPost = 1` · ชั้นวางของ 5 ชั้น (โพสต์สด) `isScheduledPost = 0`

- [ ] **Step 7: Commit**

```bash
git add app/actions.ts components/production-panel.tsx components/prompt-workspace.tsx
git commit -m "Mark scheduled posts and record where each post time came from"
```

---

### Task 5: UI — กราฟเวลาโพสต์เทียบผู้ชมออนไลน์

**Files:**
- Create: `components/post-time-panel.tsx`
- Modify: `components/dashboard-panel.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `analyzePostTimes`, `PostTimeClip`, `FollowerActivityRecord`, `SCHEDULED_RATIO_WARN` (Task 2) · `ClipMetricRecord` (มีอยู่แล้วใน `lib/recommender.ts`)

- [ ] **Step 1: เขียน `components/post-time-panel.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { videoIdFromUrl } from "@/lib/affiliate";
import type { ClipMetricRecord } from "@/lib/recommender";
import {
  analyzePostTimes,
  SCHEDULED_RATIO_WARN,
  type FollowerActivityRecord,
  type PostTimeClip,
} from "@/lib/post-time";

export type PostTimeEntry = {
  id: string;
  productName: string;
  videoUrl: string;
  postedTimeOfDay: string | null;
  postedTimeSource: string | null;
  isScheduledPost: boolean;
};

/** แสดงชั่วโมงแบบ 24 ชม. เสมอ ห้าม AM/PM */
function hourLabel(hour: number): string {
  return String(hour).padStart(2, "0") + ":00";
}

export function PostTimePanel({
  entries,
  metrics,
  followerActivity,
}: {
  entries: PostTimeEntry[];
  metrics: ClipMetricRecord[];
  followerActivity: FollowerActivityRecord[];
}) {
  const [includeManual, setIncludeManual] = useState(false);

  const clips = useMemo<PostTimeClip[]>(() => {
    // วิวล่าสุดต่อ entry จาก snapshot ที่ capture ทีหลังสุด
    const latestViews = new Map<string, { at: number; views: number }>();
    for (const m of metrics) {
      if (!m.matchedEntryId) continue;
      const cur = latestViews.get(m.matchedEntryId);
      const at = m.capturedOn.getTime();
      if (!cur || at > cur.at) latestViews.set(m.matchedEntryId, { at, views: m.views });
    }
    return entries.map((e) => ({
      entryId: e.id,
      productName: e.productName,
      videoId: videoIdFromUrl(e.videoUrl),
      postedTimeOfDay: e.postedTimeOfDay,
      postedTimeSource: e.postedTimeSource,
      isScheduledPost: e.isScheduledPost,
      views: latestViews.get(e.id)?.views ?? null,
    }));
  }, [entries, metrics]);

  const analysis = useMemo(
    () => analyzePostTimes({ clips, followerActivity, includeManual }),
    [clips, followerActivity, includeManual]
  );

  const chartData = analysis.buckets.map((b) => ({
    hour: hourLabel(b.hour),
    medianViews: b.medianViews,
    followersActive: b.followersActive ?? 0,
    clipCount: b.clipCount,
  }));

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground/90">
          <Clock className="size-4 text-marigold" />
          เวลาโพสต์ vs ยอดวิว
        </span>
        <label className="ml-auto flex items-center gap-1.5 font-mono text-[0.7rem] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeManual}
            onChange={(e) => setIncludeManual(e.target.checked)}
          />
          รวมเวลาที่กรอกเอง
        </label>
      </div>

      {analysis.usableClips === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีคลิปที่อ่านเวลาได้ — นำเข้าข้อมูลวิวก่อน
        </p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value: number, name: string) =>
                  name === "medianViews"
                    ? [value.toLocaleString(), "วิว (median)"]
                    : [value.toLocaleString(), "ผู้ติดตามออนไลน์"]
                }
              />
              <Bar yAxisId="left" dataKey="medianViews" fill="var(--color-marigold)" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="followersActive"
                stroke="var(--color-rust)"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-col gap-0.5 border-t border-border pt-2 font-mono text-[0.7rem] text-muted-foreground">
        <span>
          วิเคราะห์จาก {analysis.usableClips} คลิป · ข้าม {analysis.skippedScheduled} (ตั้งเวลา) ·
          ข้าม {analysis.skippedNoViews} (ไม่มีข้อมูลวิว)
        </span>
        {!analysis.enoughData && (
          <span>
            ยังน้อยเกินจะสรุป — เก็บอีก ~{analysis.clipsNeededForConfidence} คลิปจะเริ่มเชื่อได้
          </span>
        )}
        {analysis.peakPostHours.length > 0 && analysis.peakFollowerHours.length > 0 && (
          <span>
            คุณโพสต์บ่อยสุด {analysis.peakPostHours.map(hourLabel).join(", ")} ·
            ผู้ติดตามออนไลน์เยอะสุด {analysis.peakFollowerHours.map(hourLabel).join(", ")}
          </span>
        )}
        {analysis.scheduledRatio > SCHEDULED_RATIO_WARN && (
          <span>
            คลิปตั้งเวลาเยอะขึ้นจนข้อมูลเริ่มไม่พอ — ถ้าอยากให้วิเคราะห์ต่อได้ ต้องกรอกเวลาเผยแพร่ตอนวางลิงก์
          </span>
        )}
      </div>
    </div>
  );
}
```

**หมายเหตุ:** ห้ามเพิ่มข้อความชี้นำแบบ "ควรโพสต์ 20:00" — บรรทัด peak เป็นการรายงานข้อเท็จจริงสองอย่างคู่กันเท่านั้น การสรุปว่าอะไรดีกว่าเป็นหน้าที่ผู้ใช้จนกว่า `enoughData` จะเป็น true

- [ ] **Step 2: ต่อเข้า `components/dashboard-panel.tsx`**

เพิ่ม import:

```ts
import { PostTimePanel, type PostTimeEntry } from "@/components/post-time-panel";
```

เปลี่ยน prop `entries` ของ `DashboardPanel` จาก `{ id: string; productName: string }[]` เป็น `PostTimeEntry[]` (superset — `Recommendations` ใช้แค่ `id`/`productName` จึงยังทำงานได้เหมือนเดิม) และวาง component ต่อจาก `<Recommendations>`:

```tsx
      <PostTimePanel
        entries={entries}
        metrics={clipMetrics}
        followerActivity={followerActivity}
      />
```

ใน `components/prompt-workspace.tsx` แก้ที่สร้าง `entries` ให้ส่งฟิลด์ครบตาม `PostTimeEntry`:

```ts
  const entries = useMemo(
    () =>
      prompts.map((p) => ({
        id: p.id,
        productName: p.productName,
        videoUrl: p.videoUrl,
        postedTimeOfDay: p.postedTimeOfDay,
        postedTimeSource: p.postedTimeSource,
        isScheduledPost: p.isScheduledPost,
      })),
    [prompts]
  );
```

- [ ] **Step 3: บันทึกค่าคงที่ใน `CLAUDE.md`**

ในหัวข้อ **"ค่าคงที่ที่ผูกกับสเกลข้อมูล (ต้องทบทวนเป็นระยะ)"** เพิ่มบรรทัด:

```markdown
- `MIN_CLIPS_FOR_CONFIDENCE` (30) ใน `lib/post-time.ts` — จำนวนคลิปขั้นต่ำก่อนจะเชื่อรูปแบบ "เวลาโพสต์ vs วิว" ได้ ตั้งไว้ตอนมีคลิปใช้ได้จริงแค่ 13 ตัวและวิวถูกครอบงำโดย outlier 2 ตัว · `SCHEDULED_RATIO_WARN` (0.4) ในไฟล์เดียวกันเป็นสัดส่วน (scale-free) ไม่ต้องทบทวน
```

ในหัวข้อ **Dashboard** เพิ่มบรรทัดอธิบายฟีเจอร์:

```markdown
- `lib/video-id-time.ts` ถอด "เวลาอัปโหลด" จาก TikTok video id (snowflake: `BigInt(id) >> 32n` = Unix seconds) — **เป็นเวลาอัปโหลด ไม่ใช่เวลาเผยแพร่** คลิปที่ตั้งเวลาไว้จะได้เวลาผิด จึงมี cross-check ใน `importClipMetrics` ที่เทียบวันจาก id กับ `postedDate` ในไฟล์ ถ้าไม่ตรงจะตั้ง `isScheduledPost` แล้ว `analyzePostTimes` (`lib/post-time.ts`) จะตัดออก · **timezone: เวลาจาก id เป็น UTC ต้อง +7 ส่วน `hour` ใน FollowerActivity.csv เป็นเวลาไทยอยู่แล้ว ห้ามแปลงซ้ำ** (ตรวจว่าถูกด้วยการดูพีคผู้ติดตาม ต้องอยู่ที่ 20:00)
```

- [ ] **Step 4: Verify type-check + lint**

Run: `npx tsc --noEmit`
Expected: ผ่าน

Run: `npm run lint`
Expected: สะอาด ไม่มี warning ใหม่ (warning `followerActivity` unused จาก Task 3 ควรหายแล้ว)

- [ ] **Step 5: Verify ในแอปจริง**

รัน dev server แยก (`NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`) เปิดแท็บ Dashboard
Expected:
- เห็นกล่อง "เวลาโพสต์ vs ยอดวิว" มีกราฟแท่ง (วิว) + เส้น (ผู้ติดตาม) บนแกน `00:00`–`23:00` **ไม่มี AM/PM**
- เส้นผู้ติดตามพีคที่ **20:00** (ถ้าพีคไปอยู่ตี 3 = แปลง timezone เกิน ต้องแก้)
- แท่งวิวกระจุกช่วง **10:00–13:00**
- บรรทัดสถานะขึ้น "ยังน้อยเกินจะสรุป" และบอกจำนวนที่ข้าม
- **ไม่มีข้อความแนะนำว่าควรโพสต์เวลาไหน**
- ติ๊ก "รวมเวลาที่กรอกเอง" แล้วตัวเลขเปลี่ยนได้โดยไม่ crash
- ไม่มี emoji · ไม่มี console error

หยุด dev server ของตัวเองเมื่อเสร็จ แล้วลบ `dev-test.db` ทิ้ง

- [ ] **Step 6: Commit**

```bash
git add components/post-time-panel.tsx components/dashboard-panel.tsx components/prompt-workspace.tsx CLAUDE.md
git commit -m "Chart posting hour against views and audience activity"
```

---

## Self-Review (ผู้เขียนแผนตรวจแล้ว)

**Spec coverage:** §1 รูปแบบ 24 ชม. → Global Constraints + `hourLabel` (Task 5) · §2 data model → Task 1 · §3 ป้ายที่มา → Task 4 Step 1 + `analyzePostTimes` · §4 toggle + default ปรับเอง → Task 4 Step 3-4 · §5 cross-check → Task 4 Step 2 · §6 parser → Task 3 · §7 วิเคราะห์ → Task 2 · §8 UI → Task 5 · §9 ช่องอัปโหลด → Task 3 Step 6 · §timezone → Global Constraints + verify ทุก task ที่เกี่ยวข้อง · §ไม่ทำ (ไม่ฟันธงเวลา/ไม่ถามย้อนหลัง/ไม่แตะ postedAt) → ระบุเป็นข้อห้ามใน Task 4-5

**Type consistency:** `PostTimeClip`/`FollowerActivityRecord`/`HourBucket`/`PostTimeAnalysis` ประกาศครั้งเดียวใน `lib/post-time.ts` ใช้ตรงกันทุกที่ · `PostTimeEntry` ประกาศใน `post-time-panel.tsx` และ `prompt-workspace.tsx` สร้างให้ครบฟิลด์ (Task 5 Step 2) · `parseCsvRows`/`parseMonthDayLabel` ย้ายไป `lib/csv.ts` แล้ว `clip-metrics.ts` import ใช้ (Task 3 Step 2) ไม่มีนิยามซ้ำ · `uploadedAtFromVideoId`/`thaiHourOf`/`thaiDateKey` จาก `lib/video-id-time.ts` ใช้ทั้งใน `post-time.ts` และ `actions.ts`

**Placeholder scan:** ไม่มี TBD/TODO — ทุก step ที่แก้โค้ดมีโค้ดจริงครบ · verification เป็นคำสั่งจริงพร้อมค่าที่คาดหวังเจาะจง (167 แถว, พีค 20:00, ที่ลับเล็บแมวต้องถูก mark) · ไม่มี unit test เพราะโปรเจกต์ไม่มี test runner (ระบุใน Global Constraints)

**จุดที่ต้องระวังเป็นพิเศษ:** Task 3 ย้าย helper ออกจาก `clip-metrics.ts` — ถ้าลบไม่ครบจะเหลือนิยามซ้ำและ lint จะฟ้อง · Task 5 เปลี่ยน type ของ prop `entries` ใน `DashboardPanel` ซึ่งกระทบ `Recommendations` ด้วย (เป็น superset จึงยังทำงานได้ แต่ต้องส่งฟิลด์ครบจาก `prompt-workspace.tsx`)
