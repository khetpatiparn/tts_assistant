"use client";

// เสียงแจ้งเตือนเมื่อการเรียก AI จบ (สำเร็จหรือพัง) — สังเคราะห์ด้วย Web Audio API
// ไม่ใช้ไฟล์เสียง (ไม่ต้องอัปโหลด/โฮสต์ asset) ทำงานได้แม้ไม่มีเน็ต

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
