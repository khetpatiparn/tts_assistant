"use client";

import { useState, useTransition } from "react";

import { setPostsPerDay } from "@/app/actions";
import { MAX_POSTS_PER_DAY, MIN_POSTS_PER_DAY, parsePostsPerDay } from "@/lib/clip-export";

/**
 * "โพสต์วันละ [N] คลิป" — โควต้าต่อวันของโฟลเดอร์ TTS (วันที่ในโฟลเดอร์ = วันที่จะโพสต์) · กด Enter หรือออกจากช่องเพื่อบันทึก
 * เก็บใน tts-settings.json ไม่ต้อง build ใหม่ · มีผลกับการส่งเข้าโฟลเดอร์ครั้งถัดไป (โฟลเดอร์ที่ส่งไปแล้วไม่ถูกย้าย)
 */
export function PostsPerDayControl({ initial }: { initial: number }) {
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(String(initial));
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function commit() {
    const n = parsePostsPerDay(text);
    if (n === null) {
      setMessage(`ตั้งได้ ${MIN_POSTS_PER_DAY}–${MAX_POSTS_PER_DAY} คลิปต่อวัน`);
      return;
    }
    if (n === saved) {
      setText(String(n));
      setMessage("");
      return;
    }
    startTransition(async () => {
      try {
        const next = await setPostsPerDay(n);
        setSaved(next);
        setText(String(next));
        setMessage("บันทึกแล้ว — ใช้กับการส่งครั้งถัดไป");
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-relaxed">
      <label htmlFor="posts-per-day" className="text-foreground">
        โพสต์วันละ
      </label>
      <input
        id="posts-per-day"
        type="number"
        inputMode="numeric"
        min={MIN_POSTS_PER_DAY}
        max={MAX_POSTS_PER_DAY}
        value={text}
        disabled={pending}
        onChange={(e) => {
          setText(e.target.value);
          setMessage("");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="h-11 w-16 rounded-md border border-border-interactive bg-background px-2 text-center text-sm text-foreground lg:h-9"
      />
      <span className="text-foreground">คลิป</span>
      <span role="status" className="text-xs text-muted-foreground">
        {message}
      </span>
    </div>
  );
}
