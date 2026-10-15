"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Copy, Download, ExternalLink, ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

/** ลิงก์ Flow ของบัญชีที่ผู้ใช้ล็อกอินอยู่ในเบราว์เซอร์ (บัญชีหลัก Ultra) — ไม่ใช่โปรเจกต์ของบอทซึ่งอยู่บัญชีสำรอง */
const FLOW_URL = "https://flow.google.com/?hl=en";

/** สูตรที่ผู้ใช้ทำคลิปเองจริง (ตรงกับ docs/superpowers/specs/2026-09-30-flow-video-render-design.md) */
const RECIPE = "Video · Ingredients · 9:16 · Omni 1.1 Flash · 720p · 10s · x1";

/**
 * คลิปบอร์ดของเบราว์เซอร์รับรูปได้แค่ image/png — รูปจาก Flow เป็น jpg/png ปนกัน จึงวาดลง canvas แล้วส่งออกเป็น png
 * เสมอ (ไฟล์เดิมบนดิสก์ไม่ถูกแตะ)
 */
async function copyImageToClipboard(src: string): Promise<void> {
  const blob = await (await fetch(src)).blob();
  const png =
    blob.type === "image/png"
      ? blob
      : await new Promise<Blob>((resolve, reject) => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext("2d")?.drawImage(img, 0, 0);
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("แปลงรูปไม่สำเร็จ"))), "image/png");
          };
          img.onerror = () => reject(new Error("โหลดรูปไม่สำเร็จ"));
          img.src = URL.createObjectURL(blob);
        });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/**
 * "ทำคลิปเองใน Flow" — ผู้ใช้เลือก (2026-09-30) ทำคลิปเองในบัญชีหลักแทนให้บอท Render: ดูตัวอย่างใน Flow ได้ทันที
 * แก้/กดใหม่ได้เลย ไม่ต้องรอจังหวะพักของบอท · แผงนี้แค่ยื่นของที่ต้องใช้ให้ครบในที่เดียว (รูป 2 รูป + 10-part prompt
 * + สูตร) ไม่ได้คุยกับ Flow เอง
 */
export function ManualRenderPanel({
  entryId,
  prompt,
  images,
  onFinish,
  finishDisabled,
  collapsed = false,
}: {
  entryId: string;
  prompt: string;
  images: { id: string; src: string; label: string; downloadName: string }[];
  /** มีเฉพาะงานที่ยังค้างอยู่ขั้นทำคลิป — กดแล้ว "ทำต่อเอง" (งานจบ + โฟลเดอร์ TTS) */
  onFinish?: () => void;
  finishDisabled?: boolean;
  /** งานที่จบแล้ว (อาจทำคลิปไปแล้ว) — พับไว้ ไม่ให้หน้าคิว Flow รกด้วยแผงเต็มทุกงาน */
  collapsed?: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);

  function copy(action: () => Promise<void>, done: string) {
    action()
      .then(() => setMessage(done))
      .catch(() => setMessage("คัดลอกไม่สำเร็จ — ลองกดอีกครั้ง หรือใช้ปุ่มดาวน์โหลดแทน"));
  }

  const body = (
    <>
      <ol className="flex flex-col gap-3 text-sm text-foreground">
        <li className="flex flex-wrap items-center gap-2">
          <span>1.</span>
          <a href={FLOW_URL} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <ExternalLink data-icon="inline-start" /> เปิด Flow
          </a>
          <span className="text-muted-foreground">แล้วตั้งค่า {RECIPE}</span>
        </li>
        <li className="flex flex-col gap-2">
          <span>2. คัดลอกรูปทีละรูป แล้วกด Ctrl+V ในช่องพรอมต์ของ Flow (ถ้าวางไม่ได้ ดาวน์โหลดแล้วลากไฟล์เข้าไปแทน)</span>
          <div className="flex flex-wrap gap-3">
            {images.map((img) => (
              <div key={img.id} className="flex w-32 flex-col gap-1.5">
                <Image
                  src={img.src}
                  alt={img.label}
                  width={400}
                  height={533}
                  className="aspect-[3/4] w-32 rounded-md border border-border object-cover"
                />
                <span className="text-xs text-muted-foreground">{img.label}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copy(() => copyImageToClipboard(img.src), `คัดลอก${img.label}แล้ว — ไปกด Ctrl+V ใน Flow`)}
                >
                  <ImageIcon data-icon="inline-start" /> คัดลอกรูป
                </Button>
                <a href={img.src} download={img.downloadName} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                  <Download data-icon="inline-start" /> ดาวน์โหลด
                </a>
              </div>
            ))}
          </div>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span>3.</span>
          {prompt.trim() === "" ? (
            <span className="text-muted-foreground">
              ยังไม่มี 10-part prompt — กด &quot;สร้างด้วย AI&quot; ใน{" "}
              <Link href={`/entry/${entryId}`} className="text-primary underline-offset-4 hover:underline">
                หน้างาน
              </Link>{" "}
              ก่อน
            </span>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copy(() => navigator.clipboard.writeText(prompt), "คัดลอกพรอมต์แล้ว — ไปวางใน Flow")}
              >
                <Copy data-icon="inline-start" /> คัดลอกพรอมต์
              </Button>
              <span className="text-muted-foreground">วางต่อจากรูป แล้วกดสร้าง</span>
            </>
          )}
        </li>
        <li className="text-muted-foreground">4. ได้คลิปที่พอใจแล้ว โหลดแบบ 1080p Upscaled (เมนู ⋯ → Download)</li>
      </ol>
      {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
      {onFinish && (
        <div>
          <Button type="button" disabled={finishDisabled} onClick={onFinish}>
            ทำต่อเอง (จบงาน + สร้างโฟลเดอร์ TTS)
          </Button>
        </div>
      )}
    </>
  );

  if (collapsed) {
    return (
      <details className="rounded-md border border-border bg-surface-2 p-3 leading-relaxed">
        <summary className="cursor-pointer text-sm font-medium text-foreground">ทำคลิปเองใน Flow (บัญชีหลัก)</summary>
        <div className="mt-3 flex flex-col gap-3">{body}</div>
      </details>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3 leading-relaxed">
      <p className="text-sm font-medium text-foreground">ทำคลิปเองใน Flow (บัญชีหลัก)</p>
      {body}
    </div>
  );
}
