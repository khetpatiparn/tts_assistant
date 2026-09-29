"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { regenerateScannerToken } from "@/app/actions";

/**
 * ลิงก์ปลายทางให้วางใน Showcase Scanner (ADR 0001) — ประกอบ URL ฝั่ง client ด้วย window.location.origin
 * เพราะ server ไม่รู้ว่าผู้ใช้เปิดแอปผ่าน host ไหน · "สร้างลิงก์ใหม่" ทำให้ลิงก์เก่าใช้ไม่ได้ทันที
 * จึงต้องกดยืนยันสองจังหวะ
 */
export function ScannerLinkBox({ token }: { token: string }) {
  const [current, setCurrent] = useState(token);
  const [message, setMessage] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  // server snapshot "" → ปุ่มคัดลอก disabled จน hydrate เสร็จ (ไม่ setState ใน effect)
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const link = origin === "" ? "" : `${origin}/api/scanner?token=${current}`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <p className="text-sm leading-relaxed text-foreground">
        ลิงก์สำหรับ Showcase Scanner — วางใน extension ที่ ตั้งค่า → ลิงก์ปลายทาง (ทำครั้งเดียว)
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={link === ""}
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => setMessage("คัดลอกลิงก์แล้ว"));
          }}
        >
          <Copy className="size-4" />
          คัดลอกลิงก์
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              setMessage("กดอีกครั้งเพื่อยืนยัน — ลิงก์เดิมใน extension จะใช้ไม่ได้ทันที");
              return;
            }
            setArmed(false);
            startTransition(async () => {
              setCurrent(await regenerateScannerToken());
              setMessage("สร้างลิงก์ใหม่แล้ว — คัดลอกไปวางใน extension ใหม่");
            });
          }}
        >
          <RefreshCw className="size-4" />
          {armed ? "ยืนยันสร้างลิงก์ใหม่" : "สร้างลิงก์ใหม่"}
        </Button>
      </div>
      {message && <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>}
    </div>
  );
}
