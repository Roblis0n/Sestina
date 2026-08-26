export type CoreErrorCode =
  | "invalid_input"
  | "not_found"
  | "stale_state"
  | "state_conflict"
  | "user_confirmation_required"
  | "review_blocked"
  | "operation_cancelled"
  | "projection_write_failure"
  | "storage_busy"
  | "storage_readonly"
  | "storage_corrupt"
  | "storage_unavailable"
  | "infrastructure_failure"
  | "unsupported_format";

export interface CoreError {
  readonly code: CoreErrorCode;
  readonly message: string;
}

export type CoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CoreError };

const MESSAGES: Readonly<Record<CoreErrorCode, string>> = {
  invalid_input: "The request is invalid.",
  not_found: "The requested research record was not found.",
  stale_state: "The request is stale for the current research state.",
  state_conflict: "The requested lifecycle transition is not allowed.",
  user_confirmation_required: "An explicit user action is required.",
  review_blocked: "The review could not establish a usable result.",
  operation_cancelled: "The operation was cancelled before a usable result was created.",
  projection_write_failure: "The durable local projection could not be published.",
  storage_busy: "The local research state is currently locked by another writer.",
  storage_readonly: "The local research state is not writable.",
  storage_corrupt: "The local research database is invalid or damaged.",
  storage_unavailable: "The local research database path is unavailable to this process.",
  infrastructure_failure: "The local research state is unavailable.",
  unsupported_format: "The requested output format is not supported.",
};

export function coreOk<T>(value: T): CoreResult<T> {
  return { ok: true, value };
}

export function coreErr<T = never>(code: CoreErrorCode): CoreResult<T> {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

function coreError(code: CoreErrorCode): CoreError {
  return Object.freeze({ code, message: MESSAGES[code] });
}

export function mapDomainError(error: { readonly code?: unknown }): CoreError {
  const code = typeof error.code === "string" ? error.code : "";
  if (["research_record_not_found", "review_not_found", "revision_not_found"].includes(code)) return coreError("not_found");
  if (["version_conflict", "review_version_conflict", "stale_episode_brief", "review_input_hash_mismatch", "snapshot_hash_mismatch", "appeal_source_mismatch"].includes(code)) return coreError("stale_state");
  if (code === "stale_capsule_response") return coreError("stale_state");
  if (["user_confirmation_required", "user_decision_required", "user_issue_action_required", "user_episode_action_required", "user_appeal_action_required"].includes(code)) return coreError("user_confirmation_required");
  if (["invalid_decision_transition", "invalid_issue_transition", "invalid_episode_transition", "invalid_research_room_transition", "invalid_appeal_transition", "appeal_already_active", "episode_lock_mismatch", "artifact_tombstoned", "scope_rule_conflict"].includes(code)) return coreError("state_conflict");
  if (code === "appeal_independence_not_proven") return coreError("review_blocked");
  if (code === "storage_busy") return coreError("storage_busy");
  if (["research_storage_readonly", "database_readonly"].includes(code)) return coreError("storage_readonly");
  if (code === "database_corrupt") return coreError("storage_corrupt");
  if (code === "database_unavailable") return coreError("storage_unavailable");
  if (code.startsWith("invalid_") || code === "unsafe_relative_path" || code === "unsupported_capsule_response_version") return coreError("invalid_input");
  return coreError("infrastructure_failure");
}

export function fromDomain<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code?: unknown } }): CoreResult<T> {
  return result.ok ? coreOk(result.value) : { ok: false, error: mapDomainError(result.error) };
}
