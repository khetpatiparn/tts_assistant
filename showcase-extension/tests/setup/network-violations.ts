export interface NetworkViolation {
  readonly api: string
  readonly target: string
  readonly stack: string
}

export const violations: NetworkViolation[] = []

export const resetViolations = (): void => {
  violations.length = 0
}

/** ขั้นที่ทำให้ suite แดง — แยกออกมาเพื่อให้ทดสอบได้โดยตรง ไม่ต้องพึ่งลำดับของ afterEach */
export const assertNoViolations = (): void => {
  if (violations.length === 0) return
  const detail = violations.map((v) => `${v.api} → ${v.target}`).join(', ')
  resetViolations()
  throw new Error(`E_NETWORK_DENIED: ตรวจพบความพยายามต่อ network ที่ถูกกลืน error ไว้: ${detail}`)
}
