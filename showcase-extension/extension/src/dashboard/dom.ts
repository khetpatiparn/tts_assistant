/**
 * ทางเดียวที่ UI เขียนข้อความลง DOM ได้
 *
 * V11/UT09 กำหนดว่า title และ shop ต้อง render เป็น text — payload อย่าง
 * `<img src=x onerror=...>` ต้องกลายเป็นตัวอักษร ไม่ใช่ element
 * มี static guard ใน tests/unit/dom-safety.test.ts ห้าม HTML-parsing sink ทุกตัวทั่ว extension/src คู่กัน
 */
export function setText(el: Element, value: string): void {
  el.textContent = value
}

export function appendLabeledRow(parent: Element, label: string, value: string): HTMLElement {
  const row = parent.ownerDocument.createElement('div')
  row.className = 'row'

  const labelEl = parent.ownerDocument.createElement('span')
  labelEl.className = 'row-label'
  setText(labelEl, label)

  const valueEl = parent.ownerDocument.createElement('span')
  valueEl.className = 'row-value'
  setText(valueEl, value)

  row.append(labelEl, valueEl)
  parent.append(row)
  return row
}

export function clearChildren(el: Element): void {
  el.replaceChildren()
}
