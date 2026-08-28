export type CoreErrorCode =
  | "invalid_input"
  | "not_found"
  | "stale_state"
  | "confirmation_expired"
  | "confirmation_replayed"
  | "confirmation_binding_mismatch"
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
  confirmation_expired: "The explicit confirmation has expired.",
  confirmation_replayed: "The explicit confirmation was already used.",
  confirmation_binding_mismatch: "The explicit confirmation no longer matches this session, backup, or project state.",
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
  if (["version_conflict", "review_version_conflict", "stale_episode_brief", "review_input_hash_mismatch", "snapshot_hash_mismatch", "appeal_source_mismatch", "working_memory_source_mismatch", "working_memory_command_conflict", "pilot_context_mismatch", "pilot_confirmation_expired"].includes(code)) return coreError("stale_state");
  if (code === "stale_capsule_response") return coreError("stale_state");
  if (["user_confirmation_required", "user_decision_required", "user_issue_action_required", "user_episode_action_required", "user_appeal_action_required", "user_deliberation_action_required", "user_working_memory_action_required", "user_pilot_action_required", "pilot_confirmation_replayed"].includes(code)) return coreError("user_confirmation_required");
  if (["invalid_decision_transition", "invalid_issue_transition", "invalid_episode_transition", "invalid_research_room_transition", "invalid_appeal_transition", "invalid_deliberation_transition", "invalid_deliberation_attempt", "deliberation_round_limit_reached", "deliberation_room_already_active", "deliberation_command_conflict", "appeal_already_active", "episode_lock_mismatch", "artifact_tombstoned", "scope_rule_conflict", "invalid_working_memory_transition", "working_memory_limit_reached", "invalid_closed_pilot_transition", "invalid_closed_pilot_attempt", "pilot_attempt_budget_exhausted", "pilot_late_result_rejected"].includes(code)) return coreError("state_conflict");
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
