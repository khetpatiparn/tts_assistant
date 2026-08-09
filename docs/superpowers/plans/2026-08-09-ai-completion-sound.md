# AI Completion Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เมื่อการเรียก AI (Gemini) ใน 4 จุดของแอปจบลง (ไม่ว่าสำเร็จหรือพัง) ให้เล่นเสียงสั้นๆ แจ้งเตือน พร้อมปุ่มปิด/เปิดเสียงที่จำค่าไว้ข้ามเซสชัน

**Architecture:** เสียงสังเคราะห์ด้วย Web Audio API เก็บไว้ที่ `lib/completion-sound.ts` ไฟล์เดียว (ไม่มี asset ไฟล์เสียง) — state มิวต์เก็บใน localStorage อ่าน/เขียนตรงจากทั้งฟังก์ชันเล่นเสียงและปุ่ม UI โดยไม่ผ่าน prop เพราะ 4 จุดที่เรียกเสียงกระจายอยู่คนละคอมโพเนนต์ไม่มี parent ร่วม

**Tech Stack:** Web Audio API (`AudioContext`), React `useSyncExternalStore` (ตามแบบที่ `components/reminder-banner.tsx` วางไว้แล้วในโปรเจกต์นี้), localStorage

## Global Constraints

- ห้ามรัน `npm run build`/`npm run dev` ชน port 3000 (`start.bat` ของผู้ใช้) — ใช้ `npx tsc --noEmit` + `npm run lint` เป็นหลัก ถ้าต้องเปิด dev server จริงให้ใช้ isolated dev server ตามสูตรใน CLAUDE.md (`NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001`) แล้ว kill ทิ้งหลังเช็กเสร็จ
- เช็ก `git diff tsconfig.json` ก่อน commit ทุกครั้งถ้าเปิด dev server (dev server อาจแก้ไฟล์นี้เอง) — ถ้าเปลี่ยนให้ `git checkout -- tsconfig.json`
- ห้ามใช้ hex ใน `components/*`, ห้าม `text-[...]` arbitrary font size — ใช้ design token เดิมที่มีอยู่แล้วเท่านั้น (ปุ่มใหม่ก็อปคลาสจาก `ThemeToggle` ตรงๆ)
- UI ภาษาไทยทั้งหมด, ห้าม emoji, ห้าม `git add -A`
- ไม่มี mute แยกต่อจุด (all-or-nothing) — นอกสโคปที่ตกลงไว้ในสเปก อย่าเพิ่ม
- โปรเจกต์นี้ไม่มี test runner — verification คือ `npx tsc --noEmit` + `npm run lint` + เช็กด้วยตาผ่าน isolated dev server (ไม่ใช่ automated test)

---

### Task 1: เครื่องเล่นเสียง + ปุ่มมิวต์ (foundation)

**Files:**
- Create: `lib/completion-sound.ts`
- Create: `components/sound-toggle.tsx`
- Modify: `components/entry-header.tsx`

**Interfaces:**
- Consumes: ไม่มี (ไฟล์แรกของฟีเจอร์นี้)
- Produces:
  - `isSoundMuted(): boolean` — อ่านสถานะมิวต์ปัจจุบันจาก localStorage
  - `setSoundMuted(muted: boolean): void` — เขียนสถานะมิวต์ + broadcast event ให้ UI อื่น sync
  - `playCompletionSound(outcome: "success" | "error"): void` — เล่นเสียง (เช็กมิวต์เองข้างใน) — Task 2 จะเรียกฟังก์ชันนี้
  - `SOUND_CHANGE_EVENT: string` — ชื่อ custom event ที่ broadcast ตอนมิวต์เปลี่ยน
  - คอมโพเนนต์ `<SoundToggle />` — ปุ่มมิวต์/เปิดเสียง วางในหน้า entry ทุกหน้า

- [ ] **Step 1: สร้าง `lib/completion-sound.ts`**

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

- [ ] **Step 2: สร้าง `components/sound-toggle.tsx`**

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

- [ ] **Step 3: วาง `<SoundToggle />` ใน `components/entry-header.tsx`**

ไฟล์ปัจจุบันมีหน้าตาแบบนี้ (import ที่บรรทัด 4 และปุ่ม `<ThemeToggle />` ที่บรรทัด 44):

```tsx
import { ThemeToggle } from "@/components/theme-toggle";
```
```tsx
          <ThemeToggle />
```

แก้เป็น:

```tsx
import { SoundToggle } from "@/components/sound-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
```
```tsx
          <SoundToggle />
          <ThemeToggle />
```

(วาง `SoundToggle` ก่อน `ThemeToggle` — อยู่ในบล็อก `<div className="flex items-center gap-3">` เดียวกัน ไม่ต้องแก้ className ของ div นั้น)

- [ ] **Step 4: เช็ก type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 5: เช็กด้วยตาผ่าน isolated dev server**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด `http://localhost:3001/entry/new` (หรือ entry ที่มีอยู่แล้วตัวใดตัวหนึ่ง) ตรวจ:
- เห็นปุ่มไอคอนลำโพง (`Volume2`) อยู่ข้าง `ThemeToggle` ใน header
- กดปุ่ม → ไอคอนเปลี่ยนเป็น `VolumeX` (ปิดเสียง)
- รีเฟรชหน้า → ปุ่มยังโชว์ `VolumeX` (ยืนยันว่า localStorage จำค่าไว้)
- กดอีกครั้ง → กลับเป็น `Volume2`
- ไม่มี console error, ไม่มี hydration warning

หลังเช็กเสร็จ: kill dev server, ลบ `dev-test.db`, เช็ก `git diff tsconfig.json` ว่าง (ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`)

- [ ] **Step 6: Commit**

```bash
git add lib/completion-sound.ts components/sound-toggle.tsx components/entry-header.tsx
git commit -m "Add AI completion sound engine and mute toggle"
```

---

### Task 2: เชื่อมเสียงเข้ากับ 4 จุดที่เรียก AI

**Files:**
- Modify: `components/entry-workspace.tsx`
- Modify: `components/brief-form.tsx`
- Modify: `components/angle-panel.tsx`
- Modify: `components/product-spec-panel.tsx`

**Interfaces:**
- Consumes: `playCompletionSound(outcome: "success" | "error"): void` จาก `@/lib/completion-sound` (Task 1)
- Produces: ไม่มี (task สุดท้ายของแผนนี้)

ทั้ง 4 ไฟล์มีโครง handler เดียวกัน: `startX(async () => { try { ... } catch (e) { setError(...) } })` — งานคือเพิ่มตัวแปร `outcome` ที่เริ่มเป็น `"success"`, ตั้งเป็น `"error"` ใน catch, แล้วเรียก `playCompletionSound(outcome)` เป็นบรรทัดสุดท้ายของ callback (นอก try/catch เพื่อให้รันทั้งสองกรณี)

- [ ] **Step 1: แก้ `components/entry-workspace.tsx`**

เพิ่ม import (ต่อจาก import อื่นๆ ที่มีอยู่แล้วในไฟล์):

```tsx
import { playCompletionSound } from "@/lib/completion-sound";
```

หา `handleGenerate` (ปัจจุบัน):

```tsx
  function handleGenerate() {
    if (!entry) return;
    setGenError(null);
    startGenerating(async () => {
      try {
        const result = await generateWithAI(entry.id, model);
        // 10-part prompt บันทึกแล้วแน่นอน แม้ caption จะพัง — ไปแท็บผลลัพธ์เสมอ
        setTab("production");
        if (result.captionError) {
          setGenError(`สร้าง 10-part prompt สำเร็จ แต่ Caption ไม่สำเร็จ: ${result.captionError}`);
        }
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "สร้างด้วย AI ไม่สำเร็จ");
      }
    });
  }
```

แก้เป็น:

```tsx
  function handleGenerate() {
    if (!entry) return;
    setGenError(null);
    startGenerating(async () => {
      let outcome: "success" | "error" = "success";
      try {
        const result = await generateWithAI(entry.id, model);
        // 10-part prompt บันทึกแล้วแน่นอน แม้ caption จะพัง — ไปแท็บผลลัพธ์เสมอ
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

(หมายเหตุ: กรณี `captionError` ถือเป็น `"success"` เพราะ try block ไม่ throw — 10-part prompt คืองานหลักที่สำเร็จ ส่วน caption ที่พังมีข้อความ `genError` แสดงแยกอยู่แล้ว ไม่ต้องมีเสียงระดับที่ 3)

- [ ] **Step 2: แก้ `components/brief-form.tsx`**

เพิ่ม import:

```tsx
import { playCompletionSound } from "@/lib/completion-sound";
```

หา `handleExtract` (ปัจจุบัน):

```tsx
  function handleExtract() {
    if (extractImages.length === 0) return;
    setExtractError(null);
    startExtracting(async () => {
      try {
        const formData = new FormData();
        for (const file of extractImages) formData.append("files", file);
        const fields = await extractProductInfo(formData);
        onExtracted(fields);
        setExtractImages([]);
        setExtractOpen(false);
      } catch (e) {
        setExtractError(e instanceof Error ? e.message : "สกัดข้อมูลไม่สำเร็จ");
      }
    });
  }
```

แก้เป็น:

```tsx
  function handleExtract() {
    if (extractImages.length === 0) return;
    setExtractError(null);
    startExtracting(async () => {
      let outcome: "success" | "error" = "success";
      try {
        const formData = new FormData();
        for (const file of extractImages) formData.append("files", file);
        const fields = await extractProductInfo(formData);
        onExtracted(fields);
        setExtractImages([]);
        setExtractOpen(false);
      } catch (e) {
        outcome = "error";
        setExtractError(e instanceof Error ? e.message : "สกัดข้อมูลไม่สำเร็จ");
      }
      playCompletionSound(outcome);
    });
  }
```

- [ ] **Step 3: แก้ `components/angle-panel.tsx`**

เพิ่ม import:

```tsx
import { playCompletionSound } from "@/lib/completion-sound";
```

หา `handleSuggest` (ปัจจุบัน):

```tsx
  function handleSuggest() {
    setError(null);
    startSuggesting(async () => {
      try {
        setSuggestions(await suggestAngles(entryId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "คิด angle ไม่สำเร็จ");
      }
    });
  }
```

แก้เป็น:

```tsx
  function handleSuggest() {
    setError(null);
    startSuggesting(async () => {
      let outcome: "success" | "error" = "success";
      try {
        setSuggestions(await suggestAngles(entryId));
      } catch (e) {
        outcome = "error";
        setError(e instanceof Error ? e.message : "คิด angle ไม่สำเร็จ");
      }
      playCompletionSound(outcome);
    });
  }
```

**อย่าแก้ `handleSaveAngle`/`startSaving` ในไฟล์เดียวกัน** — นั่นคือการบันทึก angle ที่ผู้ใช้พิมพ์เอง ไม่ได้เรียก AI ไม่อยู่ในสโคปของฟีเจอร์นี้

- [ ] **Step 4: แก้ `components/product-spec-panel.tsx`**

เพิ่ม import:

```tsx
import { playCompletionSound } from "@/lib/completion-sound";
```

หา `handleRefresh` (ปัจจุบัน):

```tsx
  function handleRefresh() {
    setError(null);
    startRefreshing(async () => {
      try {
        setDraft(await refreshProductSpec(entryId, model));
      } catch (e) {
        setError(e instanceof Error ? e.message : "สกัดสเปกไม่สำเร็จ");
      }
    });
  }
```

แก้เป็น:

```tsx
  function handleRefresh() {
    setError(null);
    startRefreshing(async () => {
      let outcome: "success" | "error" = "success";
      try {
        setDraft(await refreshProductSpec(entryId, model));
      } catch (e) {
        outcome = "error";
        setError(e instanceof Error ? e.message : "สกัดสเปกไม่สำเร็จ");
      }
      playCompletionSound(outcome);
    });
  }
```

**อย่าแก้ `commit`/`startSaving` ในไฟล์เดียวกัน** — นั่นคือการบันทึกสเปกที่ผู้ใช้แก้เอง ไม่ได้เรียก AI ไม่อยู่ในสโคปของฟีเจอร์นี้

- [ ] **Step 5: เช็ก type และ lint**

Run: `npx tsc --noEmit`
Expected: ไม่มี error

Run: `npm run lint`
Expected: ไม่มี error

- [ ] **Step 6: เช็กด้วยตาผ่าน isolated dev server ทั้ง 4 จุด**

```bash
cp dev.db dev-test.db
NEXT_DIST_DIR=.next-dev DATABASE_URL="file:./dev-test.db" npm run dev -- -p 3001
```

เปิด entry ที่มีรูปสินค้าอัปโหลดแล้ว (จำเป็นสำหรับกด "สร้างด้วย AI" ได้จริง) ตรวจทีละจุด:

1. **"สร้างด้วย AI"** (แท็บ Brief & Script) — กดแล้วรอจนจบ → ได้ยินเสียงติ๊ง 2 โน้ต
2. **"สกัดข้อมูล"** (เปิดแผง "สกัดจากแคปหน้าสินค้า" ในฟอร์ม Brief แล้วแนบรูป) — กดแล้วรอจนจบ → ได้ยินเสียง
3. **"เสนอ angle ใหม่"** (ในแผง Angle ของฟอร์ม Brief) — กดแล้วรอจนจบ → ได้ยินเสียง
4. **รีเฟรช product spec** (ปุ่มรีเฟรชในแผง Product Spec) — กดแล้วรอจนจบ → ได้ยินเสียง

ทดสอบกรณี error อย่างน้อย 1 จุด: ตั้ง `GEMINI_API_KEY` ในไฟล์ `.env.local` ชั่วคราวเป็นค่าผิด (หรือปิดเน็ต) แล้วกด "สร้างด้วย AI" → error message ขึ้นตามเดิม **และ** ได้ยินเสียงป๊อกทุ้ม (ไม่ใช่เงียบ) — แก้ `.env.local` กลับเป็นค่าเดิมหลังทดสอบ (**ห้ามแก้ `.env`** ตัวจริงที่มี key จริง)

ทดสอบมิวต์: กดปุ่มปิดเสียงที่ header → ทำซ้ำจุดใดจุดหนึ่งข้างบน → ไม่มีเสียงดัง

หลังเช็กเสร็จ: kill dev server, ลบ `dev-test.db`, เช็ก `git diff tsconfig.json` ว่าง (ถ้าไม่ว่างให้ `git checkout -- tsconfig.json`)

- [ ] **Step 7: Commit**

```bash
git add components/entry-workspace.tsx components/brief-form.tsx components/angle-panel.tsx components/product-spec-panel.tsx
git commit -m "Play completion sound after each AI call finishes"
```
