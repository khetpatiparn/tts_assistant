// ปลายทางที่เล็กที่สุดสำหรับ Showcase Scanner — Node 18+ ไม่ต้องติดตั้งอะไรเพิ่ม
// รัน:  node quickstart-node.mjs   แล้วเอาลิงก์ที่พิมพ์ออกมาไปวางใน extension (ตั้งค่า → ลิงก์ปลายทาง)
// เก็บสินค้าไว้ในหน่วยความจำ (ปิดโปรแกรมแล้วหาย) — เปลี่ยนสองจุดที่เขียนว่า "ฐานข้อมูลของคุณ" เป็นของจริง
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.TOKEN ?? randomBytes(32).toString("hex"); // ตั้ง TOKEN เองได้ ไม่งั้นสุ่มใหม่ทุกครั้งที่รัน
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const products = new Map(); // ฐานข้อมูลของคุณ: productId -> สินค้า
let lastReceivedAt = null;

function tokenOk(given) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

http
  .createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/scanner") return reply(404, { error: "not found" });
    if (!tokenOk(url.searchParams.get("token"))) return reply(401, { error: "unauthorized" });

    // GET = บอก extension ว่ามีสินค้าไหนแล้ว (ใช้หยุดสแกนเอง + ไฟเขียวบน popup)
    if (req.method === "GET") {
      return reply(200, { protocol: "showcase-scanner/1", productIds: [...products.keys()], lastReceivedAt });
    }
    if (req.method !== "POST") return reply(405, { error: "method not allowed" });

    // POST = รับสินค้า — body เป็นข้อความ JSON (Content-Type: text/plain) ต้อง JSON.parse เอง
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return reply(400, { error: "invalid JSON body" });
      }
      let added = 0;
      for (const p of Array.isArray(payload.products) ? payload.products : []) {
        if (typeof p.productId !== "string" || p.hasStatusPopup === true) continue; // สินค้าที่ TikTok บอกว่าตายแล้ว ข้ามได้
        if (!products.has(p.productId)) added++;
        products.set(p.productId, p); // ฐานข้อมูลของคุณ: upsert ด้วย productId (ส่งซ้ำได้)
      }
      lastReceivedAt = new Date().toISOString();
      reply(200, { ok: true, added });
    });
  })
  .listen(PORT, () => {
    console.log(`ลิงก์ปลายทาง (วางใน extension): http://localhost:${PORT}/scanner?token=${TOKEN}`);
  });
