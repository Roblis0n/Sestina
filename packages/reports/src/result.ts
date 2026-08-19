export type ReportErrorCode = "invalid_report" | "unsupported_report_version" | "invalid_capsule" | "capsule_too_small" | "invalid_capsule_response" | "unsupported_capsule_response_version" | "stale_capsule_response";
export interface ReportError { readonly code: ReportErrorCode; readonly message: string; }
export type ReportResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ReportError };
const MESSAGES: Readonly<Record<ReportErrorCode, string>> = {
  invalid_report: "review report is invalid", unsupported_report_version: "review report schema version is unsupported",
  invalid_capsule: "review capsule is invalid", capsule_too_small: "capsule byte limit is too small for required metadata",
  invalid_capsule_response: "capsule response is invalid", unsupported_capsule_response_version: "capsule response schema version is unsupported",
  stale_capsule_response: "capsule response is stale for the current research state",
};
export function reportOk<T>(value: T): ReportResult<T> { return { ok: true, value }; }
export function reportErr<T = never>(code: ReportErrorCode): ReportResult<T> { return { ok: false, error: { code, message: MESSAGES[code] } }; }
