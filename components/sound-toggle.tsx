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
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-header-muted/50 text-header-foreground transition-colors hover:bg-header-foreground/10 focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none lg:size-9"
    >
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </button>
  );
}
