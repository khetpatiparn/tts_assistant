# เสียงแจ้งเตือนเมื่อ AI คิดเสร็จ — Design

## Context

ผู้ใช้กดปุ่มที่เรียก Gemini แล้วเดินไปทำอย่างอื่น (บางจุดใช้เวลาถึง 54 วิ) แล้วลืมว่าเสร็จหรือยัง ต้องกลับมาเปิดหน้าดูเอง แผนนี้เพิ่มเสียงสั้นๆ ให้ดังเมื่อการเรียก AI จบ (ไม่ว่าจะสำเร็จหรือพัง) พร้อมปุ่มปิด/เปิดเสียงเก็บค่าไว้ข้ามเซสชัน

## จุดที่ครอบคลุม (4 จุด — สำรวจโค้ดจริงแล้ว)

| # | ปุ่ม | ไฟล์ | handler | ระยะเวลา |
|---|---|---|---|---|
| 1 | "สร้างด้วย AI" | `components/entry-workspace.tsx` | `handleGenerate` (ใน `startGenerating`) | 15-54 วิ ⬅ ตัวหลัก |
| 2 | "สกัดข้อมูล" (จากแคปหน้าสินค้า) | `components/brief-form.tsx` | `handleExtract` (ใน `startExtracting`) | เร็ว |
| 3 | "เสนอ angle ใหม่" | `components/angle-panel.tsx` | `handleSuggest` (ใน `startSuggesting`) | เร็ว |
| 4 | รีเฟรช product spec | `components/product-spec-panel.tsx` | `handleRefresh` (ใน `startRefreshing`) | ปานกลาง |

ทั้ง 4 จุดมีโครงเดียวกัน: `startX(async () => { try { ... } catch (e) { setError(...) } })` — ไม่มี `finally` เดิม

## สถาปัตยกรรม

```
lib/completion-sound.ts       ← state (มิวต์ไหม) + เล่นเสียง อยู่ที่เดียว ไม่ผ่าน prop
components/sound-toggle.tsx   ← ปุ่ม UI อ่าน/เขียน state เดียวกัน
components/entry-header.tsx   ← วาง <SoundToggle /> ข้าง <ThemeToggle />
(4 ไฟล์ข้างบน)                ← เรียก playCompletionSound(outcome) ท้าย handler
```

**เหตุผลที่แยก state ไว้ที่ `lib/completion-sound.ts` แทนการส่ง prop:** 4 จุดที่เรียกเสียงกระจายอยู่คนละคอมโพเนนต์ คนละหน้าที่ ไม่มี parent ร่วมที่เหมาะจะถือ state — ให้ทุกจุดอ่านค่ามิวต์ล่าสุดจาก localStorage โดยตรงตอนเรียก ง่ายกว่าและไม่ทำให้ 4 ไฟล์ต้องรับ prop ใหม่

## `lib/completion-sound.ts` (ใหม่)

```ts
// เสียงแจ้งเตือนเมื่อการเรียก AI จบ (สำเร็จหรือพัง) — สังเคราะห์ด้วย Web Audio API
// ไม่ใช้ไฟล์เสียง (ไม่ต้องอัปโหลด/โฮสต์ asset) ทำงานได้แม้ไม่มีเน็ต
"use client";

const MUTE_KEY = "ai-sound-muted";
export const SOUND_CHANGE_EVENT = "ai-sound:changed";

export function isSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    // โหมดส่วนตัวบางเบราว์เซอร์อ่าน localStorage ไม่ได้ — ถือว่าไม่มิวต์ (ค่าเริ่มต้น)
    return false;
  }
}

export function setSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "true" : "false");
  } catch {
    // เขียนไม่ได้ก็ไม่เป็นไร แค่ไม่ถูกจำข้ามเซสชัน (เหมือน theme-toggle.tsx)
  }
  window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
}

/**
 * เล่นเสียงสั้นๆ บอกว่า AI คิดจบแล้ว (ไม่ว่าผลจะสำเร็จหรือพัง) —
 * ห่อทั้งฟังก์ชันด้วย try/catch เผื่อเบราว์เซอร์ไม่รองรับ AudioContext
 * หรือบล็อกการเล่นเสียง จะได้ไม่ทำให้ handler ที่เรียกพังตาม
 */
export function playCompletionSound(outcome: "success" | "error"): void {
  if (isSoundMuted()) return;
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    function tone(freq: number, start: number, duration: number) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.15, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    }

    if (outcome === "success") {
      // 2 โน้ตไล่ขึ้น สั้นกระชับ (เหมือนเสียง "ติ๊ง")
      tone(880, 0, 0.12);
      tone(1318.5, 0.1, 0.16);
    } else {
      // โน้ตเดียวทุ้มกว่า สั้นกว่า (เหมือนเสียง "ป๊อก")
      tone(330, 0, 0.18);
    }

    // ปิด AudioContext หลังเล่นจบกันชิ้นค้าง (เบราว์เซอร์จำกัดจำนวน context พร้อมกัน)
    setTimeout(() => ctx.close(), 500);
  } catch {
    // เล่นเสียงไม่ได้ (เบราว์เซอร์เก่า/บล็อก) — เงียบไปเฉยๆ ไม่ throw ต่อ
  }
}
```

## `components/sound-toggle.tsx` (ใหม่)

ตามแบบ `useSyncExternalStore` ที่ `reminder-banner.tsx` วางไว้แล้วในโปรเจกต์นี้ (อ่าน localStorage ปลอดภัยกับ SSR โดยไม่ทำ hydration mismatch):

```tsx
"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { SOUND_CHANGE_EVENT, isSoundMuted, setSoundMuted } from "@/lib/completion-sound";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SOUND_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SOUND_CHANGE_EVENT, callback);
  };
}

export function SoundToggle() {
  // server ไม่มี localStorage — คืนค่า "ไม่มิวต์" เสมอ (ตรงกับค่าเริ่มต้นจริง
  // ของคนส่วนใหญ่ที่ไม่เคยกดปิด) กัน hydration mismatch แบบเดียวกับ reminder-banner.tsx
  const getServerSnapshot = useCallback(() => false, []);
  const muted = useSyncExternalStore(subscribe, isSoundMuted, getServerSnapshot);

  return (
    <button
      type="button"
      onClick={() => setSoundMuted(!muted)}
      aria-label={muted ? "เปิดเสียงแจ้งเตือน AI" : "ปิดเสียงแจ้งเตือน AI"}
      title={muted ? "เปิดเสียงแจ้งเตือน AI" : "ปิดเสียงแจ้งเตือน AI"}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-header-muted/50 text-header-foreground transition-colors hover:bg-header-foreground/10 focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none"
    >
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </button>
  );
}
```

## แก้ `components/entry-header.tsx`

เพิ่ม `<SoundToggle />` ข้าง `<ThemeToggle />`:

```tsx
import { SoundToggle } from "@/components/sound-toggle";
...
          <SoundToggle />
          <ThemeToggle />
```

## แก้ 4 handler — เรียก `playCompletionSound` หลัง try/catch เสมอ

รูปแบบเดียวกันทั้ง 4 จุด (ตัวอย่างจาก `entry-workspace.tsx`):

```tsx
function handleGenerate() {
  if (!entry) return;
  setGenError(null);
  startGenerating(async () => {
    let outcome: "success" | "error" = "success";
    try {
      const result = await generateWithAI(entry.id, model);
      setTab("production");
      if (result.captionError) {
        setGenError(`สร้าง 10-part prompt สำเร็จ แต่ Caption ไม่สำเร็จ: ${result.captionError}`);
      }
    } catch (e) {
      outcome = "error";
      setGenError(e instanceof Error ? e.message : "สร้างด้วย AI ไม่สำเร็จ");
    }
    playCompletionSound(outcome);
  });
}
```

**หมายเหตุ:** กรณี `captionError` (10-part prompt สำเร็จแต่ caption พัง) ถือเป็น `"success"` เพราะ try block ไม่ throw — งานหลักสำเร็จ ส่วน caption ที่พังมีข้อความ `genError` แสดงแยกอยู่แล้วบนจอ ไม่ต้องมีเสียงระดับที่ 3

อีก 3 จุด (`brief-form.tsx`, `angle-panel.tsx`, `product-spec-panel.tsx`) ใช้โครงเดียวกันเป๊ะ — ประกาศ `let outcome`, ตั้งเป็น `"error"` ใน catch, เรียก `playCompletionSound(outcome)` เป็นบรรทัดสุดท้ายของ callback

## Error handling

- `playCompletionSound` ห่อด้วย try/catch ทั้งฟังก์ชัน — เล่นเสียงไม่ได้ (browser เก่า, ไม่มี `AudioContext`, autoplay ถูกบล็อก) จะเงียบไปเฉยๆ ไม่ทำให้ 4 handler ที่เรียกพังตาม
- `isSoundMuted`/`setSoundMuted` ห่อ localStorage access ด้วย try/catch เหมือน `theme-toggle.tsx` (private mode เขียนไม่ได้ก็ไม่ throw)

## Testing

โปรเจกต์นี้ไม่มี test runner — verify ด้วย isolated dev server (`NEXT_DIST_DIR=.next-dev` ตามที่ CLAUDE.md กำหนด) + เช็กด้วยตา:
- กด "สร้างด้วย AI" แล้วรอจนจบ → ได้ยินเสียงติ๊ง 2 โน้ต
- ปิดเน็ต/ใส่ API key ผิดแล้วกดใหม่ → error message ขึ้นตามเดิม + ได้ยินเสียงป๊อกทุ้ม (ไม่ใช่เงียบ)
- กดปุ่มปิดเสียงที่ header → กดปุ่ม AI ซ้ำ → ไม่มีเสียง, ไอคอนเปลี่ยนเป็น `VolumeX`
- รีเฟรชหน้า (หรือปิดเปิด browser ใหม่) หลังปิดเสียง → ปุ่มยังโชว์สถานะปิดอยู่ (ยืนยันว่า localStorage จำค่าไว้)
- ทดสอบทั้ง 4 จุด (สร้างด้วย AI, สกัดข้อมูล, เสนอ angle ใหม่, รีเฟรช spec) ว่าเสียงดังครบทุกจุด
- ไม่มี console error ตอนเล่นเสียง, ไม่มี hydration warning จากปุ่ม `SoundToggle`
- `git diff tsconfig.json` ว่างก่อน commit (ตามกฎเดิมของ repo เวลารัน dev server)

## Global Constraints

- ห้ามรัน `npm run build`/`npm run dev` ชน port 3000 — ใช้ isolated dev server ตาม CLAUDE.md
- ห้ามใช้ hex ใน `components/*`, ห้าม `text-[...]` arbitrary size — ปุ่ม `SoundToggle` ใช้ token เดิมที่ `ThemeToggle` ใช้อยู่แล้วทั้งหมด ไม่มี style ใหม่ต้องคิด
- UI ภาษาไทย, ห้าม emoji
- ไม่มี mute ต่อจุด (all-or-nothing) — ตรงตามที่ตกลงกันไว้ ไม่ทำเกินสโคป
