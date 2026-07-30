import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_Thai, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

// ฟอนต์ Latin/ตัวเลข และฟอนต์ไทยเป็นคนละตระกูลกันโดยตั้งใจ (Plus Jakarta Sans ไม่มี
// Thai glyph) — รวมเป็น --font-sans เดียวใน globals.css ด้วยการเรียงลำดับ fallback
// เบราว์เซอร์จะเลือกฟอนต์ตามตัวอักษรที่พบเอง (Thai -> Noto, Latin/ตัวเลข -> Jakarta)
const latinFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-latin",
});

const thaiFont = Noto_Sans_Thai({
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Angle",
  description: "by LAGR — ประกอบ Core Prompt สำหรับสร้างวิดีโอ TikTok Shop ด้วย Gemini Flow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={cn(
        "h-full",
        "antialiased",
        latinFont.variable,
        thaiFont.variable,
        monoFont.variable,
        "font-sans"
      )}
    >
      <body className="min-h-full flex flex-col lg:h-full lg:overflow-hidden">
        {children}
      </body>
    </html>
  );
}
