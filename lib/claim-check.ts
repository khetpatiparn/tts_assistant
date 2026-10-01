/**
 * ตัวตรวจคำเสี่ยงในข้อความที่ออกสู่คนดู (เสียงพากย์ / แคปชัน / แฮชแท็ก) — pure ห้าม import อะไร (client ใช้)
 * กฎ TikTok Shop: คำโฆษณาต้องตรงหน้าสินค้า และห้ามเสมอ: การันตีผล สุขภาพ อันดับ 1/ดีที่สุด/ถูกที่สุด รางวัล/ใบรับรอง ราคา
 * · ban = ลบก่อนโพสต์ · check = ใช้ได้ถ้าหน้าสินค้าเขียนไว้จริง (แค่เตือน ไม่จำกัดคลังคำ — ผู้ใช้กลัวคลิปซ้ำกัน)
 */
export type ClaimLevel = "ban" | "check";
export type ClaimHit = { word: string; level: ClaimLevel; where: "voiceover" | "caption" | "hashtags"; snippet: string };

export const BAN_WORDS: readonly string[] = [
  "ดีที่สุด", "ถูกที่สุด", "อันดับ 1", "อันดับหนึ่ง", "เบอร์ 1", "เบอร์หนึ่ง", "100%", "การันตี", "รับประกันผล",
  "ได้ผลแน่นอน", "เห็นผลทันที", "หายขาด", "รักษา", "ลดน้ำหนัก", "ฆ่าเชื้อ", "ทางการแพทย์", "ของแท้",
];
export const CHECK_WORDS: readonly string[] = [
  "ปลอดภัย", "ทนทาน", "เกรดอาหาร", "ไม่เป็นสนิม", "ขายดี", "กันน้ำ", "รับน้ำหนัก", "ไร้สารพิษ", "ออร์แกนิก",
];

/** วลีที่มีคำเสี่ยงอยู่ข้างในแต่ไม่ใช่การอ้างสรรพคุณ (เช่น "เก็บรักษา" ≠ รักษาโรค) — ข้ามเมื่อคำเสี่ยงอยู่ในวลีนี้ */
const SAFE_PHRASES: Record<string, readonly string[]> = {
  "รักษา": ["เก็บรักษา", "รักษาความสะอาด", "รักษารูปทรง", "รักษาความสดใหม่", "รักษาความเย็น", "รักษาอุณหภูมิ"],
};

/** ข้อความเสียงพากย์ที่คนดูได้ยิน: บล็อก "Full voice-over script" + ทุกบรรทัด "เสียงพากย์:" · ไม่รวม Negative Prompt/QA */
export function extractVoiceover(tenPart: string): string {
  const lines = tenPart.replace(/\r\n/g, "\n").split("\n");
  const picked: string[] = [];
  let inScript = false;
  for (const line of lines) {
    const t = line.trim();
    if (/voice-?over script/i.test(t)) { inScript = true; continue; }
    if (inScript) {
      if (t === "" || t.startsWith("**") || /^\d+\.\s/.test(t)) { if (t !== "") inScript = false; else if (picked.length > 0) inScript = false; continue; }
      picked.push(t);
      continue;
    }
    const m = /^(?:[-*]\s*)?เสียงพากย์\s*[:：]\s*(.+)$/.exec(t);
    if (m) picked.push(m[1]);
  }
  return picked.join("\n");
}

/**
 * บทพากย์ครั้งเดียวสำหรับเอาไปทำเสียง (ไฟล์ เสียงพากย์.txt) — ใช้บล็อก "Full voice-over script" ถ้ามี
 * ไม่งั้นต่อบรรทัด "เสียงพากย์:" ตามลำดับ · ต่างจาก extractVoiceover ที่รวมทั้งสองแบบ (ไว้ตรวจคำให้ครบ) จนบทซ้ำ
 */
export function extractVoiceoverScript(tenPart: string): string {
  const lines = tenPart.replace(/\r\n/g, "\n").split("\n");
  const script: string[] = [];
  const perBeat: string[] = [];
  let inScript = false;
  for (const line of lines) {
    const t = line.trim();
    if (/voice-?over script/i.test(t)) { inScript = true; continue; }
    if (inScript) {
      if (t === "") { if (script.length > 0) inScript = false; continue; }
      if (t.startsWith("**") || /^\d+\.\s/.test(t)) { inScript = false; continue; }
      script.push(t);
      continue;
    }
    const m = /^(?:[-*]\s*)?เสียงพากย์\s*[:：]\s*(.+)$/.exec(t);
    if (m) perBeat.push(m[1]);
  }
  const unquote = (s: string) => s.replace(/^["“”']+|["“”']+$/g, "").trim();
  return (script.length > 0 ? script : perBeat).map(unquote).filter((s) => s !== "").join("\n");
}

function isSafeContext(text: string, index: number, word: string): boolean {
  for (const phrase of SAFE_PHRASES[word] ?? []) {
    const off = phrase.indexOf(word);
    if (off >= 0 && text.startsWith(phrase, index - off)) return true;
  }
  return false;
}

/** หาคำเสี่ยงในข้อความ · คำยาวกว่าชนะ (ไม่รายงาน "ที่สุด" ซ้อนกัน) · คืนตำแหน่งแรกของแต่ละคำ */
export function findClaimWords(text: string): { word: string; level: ClaimLevel; index: number }[] {
  const all = [
    ...BAN_WORDS.map((word) => ({ word, level: "ban" as ClaimLevel })),
    ...CHECK_WORDS.map((word) => ({ word, level: "check" as ClaimLevel })),
  ].sort((a, b) => b.word.length - a.word.length);
  const taken: [number, number][] = [];
  const found: { word: string; level: ClaimLevel; index: number }[] = [];
  for (const { word, level } of all) {
    let from = 0;
    let firstFree = -1;
    for (;;) {
      const i = text.indexOf(word, from);
      if (i < 0) break;
      if (isSafeContext(text, i, word)) { from = i + word.length; continue; }
      const overlaps = taken.some(([s, e]) => i < e && i + word.length > s);
      if (!overlaps) { taken.push([i, i + word.length]); if (firstFree < 0) firstFree = i; }
      from = i + word.length;
    }
    if (firstFree >= 0) found.push({ word, level, index: firstFree });
  }
  return found.sort((a, b) => a.index - b.index);
}

function snippetAround(text: string, index: number, word: string): string {
  const s = Math.max(0, index - 20);
  const e = Math.min(text.length, index + word.length + 20);
  return `${s > 0 ? "…" : ""}${text.slice(s, e).replace(/\s+/g, " ").trim()}${e < text.length ? "…" : ""}`;
}

export function checkClaims(input: { tenPart: string; caption: string; hashtags: string }): ClaimHit[] {
  const parts: [ClaimHit["where"], string][] = [
    ["voiceover", extractVoiceover(input.tenPart)],
    ["caption", input.caption],
    ["hashtags", input.hashtags],
  ];
  const hits: ClaimHit[] = [];
  for (const [where, text] of parts) {
    for (const f of findClaimWords(text)) {
      hits.push({ word: f.word, level: f.level, where, snippet: snippetAround(text, f.index, f.word) });
    }
  }
  return hits;
}
