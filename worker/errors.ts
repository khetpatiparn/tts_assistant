/**
 * ชนิดความผิดพลาดที่ worker จำแนกได้ — ตรงกับ spec §7.4 บวก host_unsupported
 * (พบระหว่างอ่าน gflow-cli ว่า Google กำลังย้ายบัญชีไป flow.google.com ซึ่ง DOM คนละชุด)
 */
export const ERROR_KINDS = [
  "selector_drift",
  "login_required",
  "captcha",
  "generation_timeout",
  "flow_error",
  "download_failed",
  "worker_crash",
  "host_unsupported",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

/** ความผิดพลาดที่รู้ว่าเกิดขั้นไหน — ทุก step ใน flow-driver โยนตัวนี้เท่านั้น */
export class FlowStepError extends Error {
  constructor(
    public readonly step: string,
    public readonly kind: ErrorKind,
    message: string
  ) {
    super(message);
    this.name = "FlowStepError";
  }
}

export function isFlowStepError(e: unknown): e is FlowStepError {
  return e instanceof FlowStepError;
}
