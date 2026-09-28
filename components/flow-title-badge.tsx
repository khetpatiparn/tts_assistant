"use client";

import { useEffect } from "react";

const POLL_MS = 30_000;
// prefix ที่ตัวนี้ใส่เอง — ต้องลอกออกก่อนใส่ใหม่ทุกครั้ง ไม่งั้นซ้อนกันเป็น "(2) (1) Angle"
const OWN_PREFIX = /^(⚠ )?(\(\d+\) )?/;

/**
 * ใส่ตัวเลขงานที่รอคุณเลือกรูปไว้หน้าชื่อแท็บ เช่น "(3) Angle" และ "⚠" เมื่อบอท Flow หยุด —
 * เห็นได้จากแถบแท็บโดยไม่ต้องเปิดหน้า /flow (คู่กับ toast ของ worker/notify.ts ที่เด้งเฉพาะ
 * ตอนเกิดเหตุ ส่วนตัวนี้ค้างให้เห็นจนกว่าจะเคลียร์) · ไม่ render อะไร · อยู่ใน app/layout.tsx
 */
export function FlowTitleBadge() {
  useEffect(() => {
    let prefix = "";
    const apply = () => {
      const next = prefix + document.title.replace(OWN_PREFIX, "");
      if (document.title !== next) document.title = next;
    };
    const poll = async () => {
      try {
        const res = await fetch("/api/flow-status", { cache: "no-store" });
        if (!res.ok) return;
        const s = (await res.json()) as { waitingUser: number; paused: boolean };
        prefix = (s.paused ? "⚠ " : "") + (s.waitingUser > 0 ? `(${s.waitingUser}) ` : "");
        apply();
      } catch {
        // server ปิดอยู่ / เน็ตสะดุด — คง prefix เดิมไว้ รอรอบหน้า
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    // Next เขียน <title> ใหม่ตอนเปลี่ยนหน้า → ใส่ prefix กลับทันที (การเขียนของเราเองจะวนกลับมา
    // เข้า apply อีกรอบแต่ title ตรงแล้วจึงไม่เขียนซ้ำ ไม่เกิด loop)
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => {
      clearInterval(id);
      observer.disconnect();
    };
  }, []);

  return null;
}
