export type CoreErrorCode =
  | "invalid_input"
  | "not_found"
  | "stale_state"
  | "state_conflict"
  | "user_confirmation_required"
  | "review_blocked"
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
  if (["version_conflict", "review_version_conflict", "stale_episode_brief", "review_input_hash_mismatch", "snapshot_hash_mismatch"].includes(code)) return coreError("stale_state");
  if (code === "stale_capsule_response") return coreError("stale_state");
  if (["user_confirmation_required", "user_decision_required", "user_issue_action_required", "user_episode_action_required"].includes(code)) return coreError("user_confirmation_required");
  if (["invalid_decision_transition", "invalid_issue_transition", "invalid_episode_transition", "episode_lock_mismatch", "artifact_tombstoned", "scope_rule_conflict"].includes(code)) return coreError("state_conflict");
  if (["research_storage_unavailable", "research_storage_readonly", "review_storage_unavailable", "database_readonly", "database_corrupt", "storage_busy"].includes(code)) return coreError("infrastructure_failure");
  if (code.startsWith("invalid_") || code === "unsafe_relative_path" || code === "unsupported_capsule_response_version") return coreError("invalid_input");
  return coreError("infrastructure_failure");
}

export function fromDomain<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code?: unknown } }): CoreResult<T> {
  return result.ok ? coreOk(result.value) : { ok: false, error: mapDomainError(result.error) };
}
