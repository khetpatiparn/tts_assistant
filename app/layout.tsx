import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

// Noto Sans Thai คุมทั้งข้อความไทยและละติน จึงต้องโหลด subset ทั้งสองชุด
// ถ้าใส่แค่ ["thai"] ตัวอักษรละตินจะไม่มี glyph แล้วตกไปใช้ฟอนต์ระบบแบบควบคุมไม่ได้
const thaiFont = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
});

// เหลือไว้เฉพาะตัวเลขที่เรียงเป็นคอลัมน์ (เงิน วิว วันที่) ซึ่งความกว้างเท่ากันช่วยให้อ่านง่าย
// ห้ามใช้กับข้อความไทย — ฟอนต์นี้ไม่มี glyph ไทย
const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-src",
});

export const metadata: Metadata = {
  title: "Angle",
  description: "by LAGR — ประกอบ Core Prompt สำหรับสร้างวิดีโอ TikTok Shop ด้วย Gemini Flow",
};

/**
 * ยืนยันตาม node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md
 * และ node_modules/next/dist/lib/metadata/types/extra-types.d.ts (viewportFit, interactiveWidget)
 *
 * ห้ามใส่ maximumScale/userScalable เพื่อปิดการซูม — เป็นปัญหา accessibility
 * viewportFit: "cover" ทำให้เนื้อหากินพื้นที่ใต้รอยบากได้ จึงต้องคู่กับ padding
 * safe-area ใน globals.css ไม่งั้นปุ่มล่างสุดจะถูกแถบ home indicator ทับ
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // แป้นพิมพ์มือถือย่อ visual viewport แทนที่จะดันเลย์เอาต์ — กันฟอร์มกระโดด
  interactiveWidget: "resizes-visual",
};

// สคริปต์นี้ทำงานตอนเบราว์เซอร์ parse HTML คือก่อนหน้าจอวาดครั้งแรก จึงไม่มีอาการกระพริบ
// วิธีนี้มาจากเอกสารทางการของ Next.js เวอร์ชันนี้:
// node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
// ค่าเริ่มต้นคือ "dark" ตามที่ตั้งไว้บน <html> — สคริปต์เขียนทับเฉพาะเมื่อผู้ใช้เคยเลือกไว้
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      data-theme="dark"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", thaiFont.variable, monoFont.variable, "font-sans")}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        {children}
      </body>
    </html>
  );
}
