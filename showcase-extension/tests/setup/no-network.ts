import net from 'node:net'
import { afterEach, beforeEach } from 'vitest'
import { violations, resetViolations, assertNoViolations } from './network-violations.js'

export class NetworkAccessDeniedError extends Error {
  constructor(api: string, target: string) {
    super(`E_NETWORK_DENIED: ${api} → ${target} ถูกปฏิเสธใน test environment (R15)`)
    this.name = 'NetworkAccessDeniedError'
  }
}

const record = (api: string, target: string): never => {
  violations.push({ api, target, stack: new Error().stack ?? '' })
  throw new NetworkAccessDeniedError(api, target)
}

const lock = (host: Record<string, unknown>, key: string, value: unknown): void => {
  // writable:false เพียงพอที่จะทำให้ `globalThis.fetch = x` throw ใน strict mode แล้ว
  // ไม่ใส่ configurable:false เพราะ jsdom environment ของ Vitest เรียก `delete globalThis.XMLHttpRequest`
  // ตอน teardown ทุกไฟล์ทดสอบ — ถ้า non-configurable การ delete จะ throw กลายเป็น unhandled error
  // ทุกครั้งที่มีไฟล์ jsdom ในชุด suite (พังตอนจบไฟล์ ไม่ใช่ตอนทดสอบจึงไม่ทำให้ test แดง แต่ทำให้
  // teardown ของ worker พังและอาจกระทบไฟล์ jsdom อื่นในสภาพแวดล้อมเดียวกัน)
  Object.defineProperty(host, key, {
    value,
    writable: false,
    configurable: true,
    enumerable: true,
  })
}

const g = globalThis as unknown as Record<string, unknown>
for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
  // ต้องเป็น function ธรรมดา ไม่ใช่ arrow — XMLHttpRequest/WebSocket ถูกเรียกด้วย `new`
  lock(
    g,
    api,
    function (this: unknown, ...a: unknown[]): never {
      return record(api, String(a[0] ?? ''))
    },
  )
}
if (g.navigator !== null && typeof g.navigator === 'object') {
  lock(g.navigator as Record<string, unknown>, 'sendBeacon', (...a: unknown[]) =>
    record('navigator.sendBeacon', String(a[0] ?? '')),
  )
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])
const realConnect = net.Socket.prototype.connect

// ปฏิเสธเฉพาะ call ที่ระบุ TCP target ชัดเจน — ปล่อย fd / named pipe / unix socket ผ่าน
// มิฉะนั้น Vitest worker IPC บน Windows จะสตาร์ตไม่ขึ้น
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  // net.connect()/createConnection() ส่ง normalized-args array `[options, cb]` มาให้ ไม่ใช่ options ตรง ๆ
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0]
  let host: string | undefined
  let isTcp = false

  if (first !== null && typeof first === 'object') {
    const opts = first as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown }
    if (typeof opts.path !== 'string' && opts.port !== undefined) {
      isTcp = true
      host =
        typeof opts.host === 'string'
          ? opts.host
          : typeof opts.hostname === 'string'
            ? opts.hostname
            : '127.0.0.1'
    }
  } else if (typeof first === 'number') {
    // socket.connect(port, host) — string แทนจะเป็น IPC path จึงปล่อยผ่าน
    isTcp = true
    host = typeof args[1] === 'string' ? args[1] : '127.0.0.1'
  }

  if (isTcp && host !== undefined && !LOOPBACK.has(host)) {
    return record('net.connect', host)
  }
  return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args)
} as typeof net.Socket.prototype.connect

beforeEach(resetViolations)

afterEach(assertNoViolations)
