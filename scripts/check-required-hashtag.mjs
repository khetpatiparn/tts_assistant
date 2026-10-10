/**
 * ตรวจตรรกะของ lib/required-hashtag.ts (แฮชแท็กที่ต้องลง — CONTEXT.md) — pure ไม่แตะ DB
 *
 * รัน: node scripts/check-required-hashtag.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-required-hashtag-tmp-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)}\n      ควรได้ ${JSON.stringify(expected)}`);
}

try {
  // โมดูลนี้ไม่ import อะไรเลย — คอมไพล์เดี่ยวได้ ต้องจบด้วย exit 0
  execFileSync(
    "npx",
    ["tsc", "lib/required-hashtag.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "pipe", shell: true }
  );
  const h = await import(pathToFileURL(join(out, "required-hashtag.js")).href);
  const tags = (input) => {
    const r = h.normalizeHashtags(input);
    return r.ok ? r.tags : `ERR:${r.message}`;
  };

  // --- แปลงข้อความที่พิมพ์ ---
  check("มี # อยู่แล้ว", tags("#trendyselected"), ["#trendyselected"]);
  check("ลืมพิมพ์ # = เติมให้", tags("trendyselected"), ["#trendyselected"]);
  check("แยกด้วยช่องว่าง", tags("#a #b"), ["#a", "#b"]);
  check("แยกด้วยจุลภาค (มี/ไม่มีช่องว่าง)", tags("#a,#b, c"), ["#a", "#b", "#c"]);
  check("จุลภาคเต็มความกว้าง", tags("#a，#b"), ["#a", "#b"]);
  check("ขึ้นบรรทัดใหม่/แท็บ = ตัวแยก", tags("#a\n#b\t#c"), ["#a", "#b", "#c"]);
  check("พิมพ์ติดกัน #a#b = 2 อัน", tags("#a#b"), ["#a", "#b"]);
  check("## ซ้อน = อันเดียว", tags("##a"), ["#a"]);
  check("ไทยล้วนไม่มี # = เติมให้", tags("สินค้ากิจกรรม"), ["#สินค้ากิจกรรม"]);
  check("ช่องว่างหัวท้ายถูกตัด", tags("   #a   "), ["#a"]);

  // --- ซ้ำ / ตัวพิมพ์ ---
  check("ซ้ำต่างตัวพิมพ์ = เหลืออันเดียว เก็บตัวพิมพ์ที่พิมพ์ทีหลัง", tags("#TrendySelected #trendyselected"), ["#trendyselected"]);
  check("ซ้ำแล้วคงตำแหน่งของที่พิมพ์ก่อน", tags("#a #b #A"), ["#A", "#b"]);
  check("ลำดับที่พิมพ์คงเดิม", tags("#c #a #b"), ["#c", "#a", "#b"]);

  // --- อักขระล่องหน (วางจาก LINE/เว็บ): ห้ามกลายเป็นแฮชแท็กว่าง หรือติดไปกับแฮชแท็กจริง ---
  check("zero-width space ล้วน = ปฏิเสธ", typeof tags("\u200B") === "string" && tags("\u200B").startsWith("ERR:"), true);
  check("zero-width ท้ายแฮชแท็กถูกตัด", tags("#trendyselected\u200B"), ["#trendyselected"]);
  check("zero-width กลางคำถูกตัด (ไม่แตกเป็นสองอัน)", tags("#trendy\u200Bselected"), ["#trendyselected"]);
  check("BOM/word-joiner ถูกตัด", tags("\uFEFF#a\u2060"), ["#a"]);
  check("zero-width คั่นระหว่างช่องว่างยังแยกอันได้", tags("#a \u200B #b"), ["#a", "#b"]);

  // --- ปฏิเสธ (ห้ามเงียบจนกลายเป็นลบ) ---
  for (const bad of ["", "   ", "#", "##", ",", " , # , "]) {
    check(`ปฏิเสธ ${JSON.stringify(bad)}`, tags(bad).startsWith("ERR:"), true);
  }
  check("ข้อความปฏิเสธชี้ไปที่ปุ่มลบ", tags("").includes("ลบแฮชแท็ก"), true);
  const ten = Array.from({ length: 10 }, (_, i) => `#t${i}`).join(" ");
  check("10 อันพอดีผ่าน", Array.isArray(tags(ten)) && tags(ten).length === 10, true);
  check("11 อันไม่ผ่าน", tags(`${ten} #t10`).startsWith("ERR:"), true);
  check("ยาว 100 ตัว (รวม #) พอดีผ่าน", Array.isArray(tags("a".repeat(99))), true);
  check("ยาว 101 ตัวไม่ผ่าน", tags("a".repeat(100)).startsWith("ERR:"), true);

  // --- รูปแบบที่เก็บใน DB ---
  check("serialize คั่นช่องว่างเดียว", h.serializeHashtags(["#a", "#b"]), "#a #b");
  check("parse กลับ", h.parseStoredHashtags("#a #b"), ["#a", "#b"]);
  check("parse ค่าว่าง = ไม่มี", h.parseStoredHashtags(""), []);
  check("parse ช่องว่างเกิน", h.parseStoredHashtags("  #a   #b "), ["#a", "#b"]);

  // --- ตัวเลือกที่เคยพิมพ์ ---
  check("ใช้บ่อยสุดก่อน", h.suggestHashtags([["#a"], ["#b", "#a"], ["#a", "#c"], ["#b"]]), ["#a", "#b", "#c"]);
  check("เท่ากัน = ที่เจอก่อนขึ้นก่อน", h.suggestHashtags([["#x"], ["#y"]]), ["#x", "#y"]);
  check("นับต่างตัวพิมพ์เป็นอันเดียว แสดงตัวพิมพ์ที่เจอก่อน", h.suggestHashtags([["#Abc"], ["#abc"]]), ["#Abc"]);
  check("จำกัดจำนวน", h.suggestHashtags([["#a", "#b", "#c"]], 2), ["#a", "#b"]);
  check("ไม่มีสินค้ามีแฮชแท็ก = ว่าง", h.suggestHashtags([[], []]), []);

  // --- ที่เลือกต้องจำกัดอยู่ที่แถวที่มองเห็น + ตรวจข้อความฝั่งหน้าจอก่อนเรียก action (prod ซ่อนข้อความ error ของ action) ---
  check("visibleSelection ตัดตัวที่ไม่อยู่ในแท็บ", h.visibleSelection(new Set(["A", "B", "Z"]), ["A", "B", "C"]), ["A", "B"]);
  check("visibleSelection คงลำดับของรายการที่เห็น", h.visibleSelection(["B", "A"], ["A", "B"]), ["A", "B"]);
  check("visibleSelection ไม่เลือกอะไร = ว่าง", h.visibleSelection(new Set(), ["A"]), []);
  const plan = h.planHashtagApply(new Set(["A", "GONE"]), ["A", "B"], "trendyselected, #x");
  check("plan: ใส่ได้ ใช้เฉพาะที่เห็น + ข้อความที่ normalize แล้ว", plan, { ok: true, ids: ["A"], text: "#trendyselected #x" });
  const noneVisible = h.planHashtagApply(new Set(["GONE"]), ["A"], "#a");
  check("plan: เลือกไว้แต่ไม่อยู่ในแท็บ = ปฏิเสธพร้อมข้อความไทย", noneVisible.ok === false && /เลือก/.test(noneVisible.message), true);
  const badText = h.planHashtagApply(new Set(["A"]), ["A"], "#");
  check("plan: ข้อความไม่ผ่าน = ปฏิเสธพร้อมข้อความไทยเดียวกับ normalize", badText.ok === false && badText.message.includes("ลบแฮชแท็ก"), true);

  // --- เอาไปติดกับ entry ผ่านสินค้า Showcase ---
  const byEntry = h.hashtagsForEntries(
    new Map([["E1", "P1"], ["E2", "P2"], ["E3", "P3"]]),
    new Map([["P1", ["#a"]], ["P3", []]])
  );
  check("entry ที่สินค้ามีแฮชแท็ก", byEntry.get("E1"), ["#a"]);
  check("entry ที่สินค้าไม่มีแถว = ไม่อยู่ใน map", byEntry.has("E2"), false);
  check("entry ที่สินค้ามีรายการว่าง = ไม่อยู่ใน map", byEntry.has("E3"), false);
  check("entry ที่ไม่ได้มาจาก Showcase = ว่าง", h.hashtagsForEntries(new Map(), new Map([["P1", ["#a"]]])).size, 0);

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
