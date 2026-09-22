import { setText } from '../dashboard/dom.js'
import type { ResponseMap } from '../messaging/schema.js'

const requireElement = (id: string): HTMLElement => {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`missing element: ${id}`)
  return el
}

// §10: ปิด popup ไม่ใช่ cancel — งานอยู่ที่ worker ไม่ใช่ popup
requireElement('open-dashboard').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

void (async (): Promise<void> => {
  const status = requireElement('status')
  const response = (await chrome.runtime.sendMessage({
    type: 'status.get',
  })) as ResponseMap['status.get']
  setText(status, response.ok ? `สถานะ: ${response.state}` : `อ่านสถานะไม่ได้: ${response.code}`)
})()
