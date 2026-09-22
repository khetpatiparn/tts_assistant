import { FlowAError } from '../domain/errors.js'
import { ADAPTER_VERSION_LIVE } from '../domain/version.js'
import type { ShowcaseAdapter, ShowcasePageRequest, ShowcaseRawPage } from './types.js'
import type { LiveTransport } from './live-transport.js'

/**
 * observed (docs/api-observations.md §1) — hostname/path เดียวที่มีหลักฐานรองรับ
 * hardcode ไว้ตรงนี้เท่านั้น — ไม่มีที่อื่นในโค้ดที่ประกอบ URL นี้ได้ และไม่มีทางรับ URL/path
 * จาก message หรือ UI เพราะ ShowcasePageRequest มีแค่ offset/count เท่านั้น (ดู adapters/types.ts)
 */
const ENDPOINT_ORIGIN = 'https://shop.tiktok.com'
const ENDPOINT_PATH = '/api/v1/streamer_desktop/showcase_product/list'

export interface BuiltShowcaseRequest {
  readonly method: 'GET'
  readonly url: string
}

/**
 * ตรวจ offset/count ก่อนประกอบ request เสมอ — บั๊กภายใน (ไม่ใช่ TikTok ตอบผิด) ถ้าค่าไม่ถูกต้อง
 * มาถึงตรงนี้ เพราะ messaging/validate.ts และ core/pagination.ts คำนวณ offset ให้แล้วควรถูกต้องเสมอ
 * แต่ boundary ที่ประกอบ network request ต้องกันเองอีกชั้น ไม่ไว้ใจ caller เพียงอย่างเดียว
 */
export function buildShowcaseRequest(request: ShowcasePageRequest): BuiltShowcaseRequest {
  const { offset, count } = request
  if (!Number.isSafeInteger(offset) || offset < 0) throw new FlowAError('adapter_invalid_request')
  if (!Number.isSafeInteger(count) || count <= 0) throw new FlowAError('adapter_invalid_request')

  const url = new URL(ENDPOINT_PATH, ENDPOINT_ORIGIN)
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('count', String(count))
  return { method: 'GET', url: url.toString() }
}

export interface LiveAdapterDeps {
  readonly transport: LiveTransport
  /**
   * ตรวจว่า optional host permission (`https://shop.tiktok.com/*`) ได้รับอนุมัติแล้วหรือยัง —
   * **เช็คอย่างเดียว ไม่เคย request เอง** การขอสิทธิ์ (`chrome.permissions.request`) ต้องเกิดจาก
   * user gesture ในหน้า dashboard เท่านั้น ไม่ใช่จาก service worker/adapter (PK02 บังคับไว้แล้ว
   * ด้วย static check บน release bundle) ฟังก์ชันนี้แค่ตอบว่า "มีสิทธิ์อยู่แล้วหรือยัง"
   */
  readonly hasHostPermission: () => Promise<boolean>
}

/**
 * ประกอบ live adapter จาก transport + permission checker ที่ inject เข้ามา — ตัว adapter เอง
 * ไม่ตรวจ G0_VERIFIED (นั่นเป็นหน้าที่ของ resolve.live.ts ซึ่งเป็นจุดเดียวที่ตัดสินใจว่าจะสร้าง/ใช้
 * transport จริงไหม) ทำให้ไฟล์นี้ทดสอบได้อิสระจาก gate ด้วย fake ล้วน ๆ ไม่ต้องพึ่ง G0_VERIFIED เลย
 */
export function createLiveShowcaseAdapter(deps: LiveAdapterDeps): ShowcaseAdapter {
  return {
    adapterVersion: ADAPTER_VERSION_LIVE,
    mode: 'live',
    async fetchPage(request: ShowcasePageRequest, signal: AbortSignal): Promise<ShowcaseRawPage> {
      if (signal.aborted) throw new FlowAError('aborted')

      // ตรวจ permission prerequisite ก่อนยิง request เสมอ — ไม่เพิ่มสิทธิ์เกิน spec (ดู manifest.json
      // optional_host_permissions) และไม่เดาว่ามีสิทธิ์แล้วเพียงเพราะ G0_VERIFIED เป็น true
      if (!(await deps.hasHostPermission())) throw new FlowAError('permission_required')

      const built = buildShowcaseRequest(request)
      const outcome = await deps.transport.send({ method: built.method, url: built.url, signal })

      switch (outcome.kind) {
        case 'response':
          return { httpStatus: outcome.httpStatus, headers: outcome.headers, bodyText: outcome.bodyText }
        case 'redirect_blocked':
          throw new FlowAError('adapter_redirect_blocked')
        case 'timeout':
          throw new FlowAError('adapter_timeout')
        case 'aborted':
          throw new FlowAError('aborted')
        case 'network_error':
          throw new FlowAError('adapter_network_error')
        case 'body_too_large':
          throw new FlowAError('adapter_body_too_large')
      }
    },
  }
}
