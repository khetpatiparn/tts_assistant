/**
 * จำแนก request ที่ Playwright เห็นว่าเป็นการออกนอกเครื่องหรือไม่ — deny-by-default
 * scheme ที่ไม่ใช่ network (chrome-extension:, data:, blob: ฯลฯ) และปลายทาง loopback เท่านั้นที่ผ่าน
 * ทุกอย่างที่เหลือถือว่า external รวม ws:/wss: ที่เคยรอดจากการกรองแบบ http(s)-only
 */
const NON_NETWORK_SCHEMES = new Set([
  'chrome-extension:',
  'chrome:',
  'devtools:',
  'data:',
  'blob:',
  'about:',
  'file:',
])

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isExternalRequest(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    // parse ไม่ได้ = ไม่รู้จัก ต้องถือว่าน่าสงสัยไว้ก่อน
    return true
  }
  if (NON_NETWORK_SCHEMES.has(url.protocol)) return false
  return !LOOPBACK_HOSTS.has(url.hostname)
}
