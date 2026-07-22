/**
 * ไฟล์ export ของ TikTok Studio ครอบทุก field ด้วย double quote และ caption มี comma
 * อยู่ข้างใน — split(",") เฉยๆ จะพัง เขียน parser เองแทนการลง dependency ใหม่
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/**
 * วันที่ในไฟล์ TikTok เป็น "July 21" ไม่มีปี — เดาปีจากวันที่อ้างอิง (วันที่ import)
 * ถ้าวันที่ที่ได้ล้ำอนาคตเกิน 1 วัน แปลว่าเป็นปีก่อน (เช่น import ต้นมกราแต่ไฟล์ลงเดือนธันวา)
 */
export function parseMonthDayLabel(label: string, reference: Date): Date | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (month === undefined) return null;
  const day = Number(m[2]);

  let year = reference.getFullYear();
  let d = new Date(Date.UTC(year, month, day));
  if (d.getTime() - reference.getTime() > 24 * 60 * 60 * 1000) {
    year -= 1;
    d = new Date(Date.UTC(year, month, day));
  }
  return d;
}
