import { z } from "zod";

// ── Error Codes ──
export enum SestinaErrorCode {
  // Config & state
  config_version_conflict = "config_version_conflict",
  direct_user_confirmation_required = "direct_user_confirmation_required",
  insufficient_confirmation_source = "insufficient_confirmation_source",
  preview_changed = "preview_changed",
  stale_state = "stale_state",

  // IPC
  ipc_auth_failed = "ipc_auth_failed",
  ipc_protocol_mismatch = "ipc_protocol_mismatch",

  // Stream
  stream_gap = "stream_gap",

  // Contracts
  contract_conflict = "contract_conflict",
  contract_version_mismatch = "contract_version_mismatch",

  // Not found
  task_not_found = "task_not_found",
  project_not_found = "project_not_found",
  session_not_found = "session_not_found",
  boundary_not_found = "boundary_not_found",
  evidence_not_found = "evidence_not_found",
  claim_not_found = "claim_not_found",
  decision_not_found = "decision_not_found",
  contract_not_found = "contract_not_found",
  review_not_found = "review_not_found",
  collaboration_message_not_found = "collaboration_message_not_found",

  // Override
  override_invalid = "override_invalid",
  override_expired = "override_expired",
  non_overridable = "non_overridable",

  // Provider
  provider_unavailable = "provider_unavailable",
  provider_timeout = "provider_timeout",
  provider_invalid_response = "provider_invalid_response",
  provider_budget_exceeded = "provider_budget_exceeded",

  // Judge
  judge_disabled = "judge_disabled",
  judge_not_needed = "judge_not_needed",
  judgment_packet_rejected = "judgment_packet_rejected",

  // Storage
  migration_failed = "migration_failed",
  migration_too_new = "migration_too_new",
  database_corrupt = "database_corrupt",
  database_readonly = "database_readonly",
  disk_full = "disk_full",
  storage_busy = "storage_busy",
  secure_storage_unavailable = "secure_storage_unavailable",
  project_mismatch = "project_mismatch",

  // Validation
  validation_failed = "validation_failed",
  limit_exceeded = "limit_exceeded",
  idempotency_violation = "idempotency_violation",
  bypass_required = "bypass_required",

  // Security
  project_isolation_violation = "project_isolation_violation",
  unauthorized = "unauthorized",
  forbidden = "forbidden",

  // General
  internal_error = "internal_error",
}

// ── HTTP status mapping ──
const STATUS_MAP: Record<SestinaErrorCode, number> = {
  [SestinaErrorCode.config_version_conflict]: 409,
  [SestinaErrorCode.direct_user_confirmation_required]: 428,
  [SestinaErrorCode.insufficient_confirmation_source]: 403,
  [SestinaErrorCode.preview_changed]: 409,
  [SestinaErrorCode.stale_state]: 409,
  [SestinaErrorCode.ipc_auth_failed]: 403,
  [SestinaErrorCode.ipc_protocol_mismatch]: 400,
  [SestinaErrorCode.stream_gap]: 410,
  [SestinaErrorCode.contract_conflict]: 409,
  [SestinaErrorCode.contract_version_mismatch]: 409,
  [SestinaErrorCode.task_not_found]: 404,
  [SestinaErrorCode.project_not_found]: 404,
  [SestinaErrorCode.session_not_found]: 404,
  [SestinaErrorCode.boundary_not_found]: 404,
  [SestinaErrorCode.evidence_not_found]: 404,
  [SestinaErrorCode.claim_not_found]: 404,
  [SestinaErrorCode.decision_not_found]: 404,
  [SestinaErrorCode.contract_not_found]: 404,
  [SestinaErrorCode.review_not_found]: 404,
  [SestinaErrorCode.collaboration_message_not_found]: 404,
  [SestinaErrorCode.override_invalid]: 400,
  [SestinaErrorCode.override_expired]: 410,
  [SestinaErrorCode.non_overridable]: 403,
  [SestinaErrorCode.provider_unavailable]: 503,
  [SestinaErrorCode.provider_timeout]: 504,
  [SestinaErrorCode.provider_invalid_response]: 502,
  [SestinaErrorCode.provider_budget_exceeded]: 429,
  [SestinaErrorCode.judge_disabled]: 503,
  [SestinaErrorCode.judge_not_needed]: 200,
  [SestinaErrorCode.judgment_packet_rejected]: 400,
  [SestinaErrorCode.migration_failed]: 500,
  [SestinaErrorCode.migration_too_new]: 400,
  [SestinaErrorCode.database_corrupt]: 500,
  [SestinaErrorCode.database_readonly]: 503,
  [SestinaErrorCode.disk_full]: 507,
  [SestinaErrorCode.storage_busy]: 503,
  [SestinaErrorCode.secure_storage_unavailable]: 503,
  [SestinaErrorCode.project_mismatch]: 400,
  [SestinaErrorCode.validation_failed]: 400,
  [SestinaErrorCode.limit_exceeded]: 413,
  [SestinaErrorCode.idempotency_violation]: 409,
  [SestinaErrorCode.bypass_required]: 204,
  [SestinaErrorCode.project_isolation_violation]: 403,
  [SestinaErrorCode.unauthorized]: 401,
  [SestinaErrorCode.forbidden]: 403,
  [SestinaErrorCode.internal_error]: 500,
};

// ── SestinaError ──
export class SestinaError extends Error {
  public readonly code: SestinaErrorCode;
  public readonly status: number;
  public readonly details: unknown;

  constructor(
    code: SestinaErrorCode,
    message: string,
    status?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "SestinaError";
    this.code = code;
    this.status = status ?? (STATUS_MAP[code] || 500);
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

// ── Type guard ──
export function isSestinaError(value: unknown): value is SestinaError {
  return value instanceof SestinaError;
}

// ── Zod schema for serialization/deserialization ──
export const errorSchema = z.object({
  name: z.literal("SestinaError"),
  code: z.enum(SestinaErrorCode),
  message: z.string(),
  status: z.number().int(),
  details: z.unknown().optional(),
});

// ── Serialization helpers ──
export function serialiseError(err: SestinaError): string {
  return JSON.stringify(err.toJSON());
}

export function deserialiseError(json: string): SestinaError {
  const parsed = errorSchema.parse(JSON.parse(json));
  return new SestinaError(parsed.code, parsed.message, parsed.status, parsed.details);
}
