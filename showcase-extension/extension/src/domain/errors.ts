export type ScannerErrorCode =
  | 'aborted'
  | 'already_running'
  | 'adapter_body_too_large'
  | 'adapter_invalid_request'
  | 'adapter_network_error'
  | 'adapter_redirect_blocked'
  | 'adapter_timeout'
  | 'g0_not_verified'
  | 'manual_probe_not_authorized'
  | 'manual_scan_not_authorized'
  | 'mock_script_exhausted'
  | 'permission_required'
  | 'msg_forbidden_field'
  | 'msg_forbidden_sender'
  | 'msg_malformed'
  | 'msg_unknown_type'
  | 'no_report'
  | 'run_context_unavailable'

/** message ถูกประกอบจาก code เท่านั้น ไม่รับข้อมูลจากภายนอกมาต่อท้าย (§10: ไม่มี token/session ใน log) */
export class ScannerError extends Error {
  readonly code: ScannerErrorCode

  constructor(code: ScannerErrorCode) {
    super(code)
    this.name = 'ScannerError'
    this.code = code
  }
}
