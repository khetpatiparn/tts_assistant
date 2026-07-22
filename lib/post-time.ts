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
