/**
 * Stable error codes for the research domain.
 *
 * Consumers must branch on `code`, never on the English `message`.
 * Error payloads must never embed raw research content, secrets, personal
 * absolute paths or raw provider responses.
 */
export type ResearchErrorCode =
  | "invalid_research_id"
  | "invalid_entity_version"
  | "version_conflict"
  | "invalid_actor"
  | "invalid_authority_level"
  | "authority_conflict"
  | "invalid_timestamp"
  | "invalid_source"
  | "canonicalization_failed"
  | "invalid_project"
  | "invalid_artifact"
  | "invalid_artifact_kind"
  | "invalid_content_reference"
  | "unsafe_relative_path"
  | "invalid_revision"
  | "invalid_revision_parent"
  | "revision_not_found"
  | "artifact_tombstoned"
  | "invalid_research_brief"
  | "invalid_research_stage"
  | "invalid_scope_rule"
  | "scope_rule_conflict"
  | "invalid_expected_delta"
  | "invalid_evidence_boundary"
  | "invalid_brief_change"
  | "brief_change_not_found"
  | "user_confirmation_required"
  | "brief_change_already_decided"
  | "invalid_research_decision"
  | "invalid_decision_scope"
  | "invalid_decision_status"
  | "invalid_decision_transition"
  | "user_decision_required"
  | "decision_supersede_required"
  | "invalid_research_issue"
  | "invalid_issue_kind"
  | "invalid_issue_fingerprint"
  | "invalid_issue_transition"
  | "issue_reopen_not_allowed"
  | "user_issue_action_required"
  | "invalid_revision_episode"
  | "invalid_episode_status"
  | "invalid_episode_transition"
  | "invalid_episode_outcome"
  | "episode_lock_mismatch"
  | "stale_episode_brief"
  | "user_episode_action_required"
  | "invalid_episode_waiver"
  | "invalid_research_snapshot"
  | "snapshot_hash_mismatch"
  | "invalid_pagination"
  | "research_record_not_found"
  | "research_storage_unavailable"
  | "research_storage_readonly"
  | "invalid_claim"
  | "invalid_mechanism_link"
  | "invalid_argument_delta";

export type ResearchErrorDetails = Readonly<
  Record<string, string | number | boolean>
>;

export interface ResearchError {
  readonly code: ResearchErrorCode;
  readonly message: string;
  readonly details?: ResearchErrorDetails;
}

export function researchError(
  code: ResearchErrorCode,
  details?: ResearchErrorDetails,
): ResearchError {
  return { code, message: MESSAGES[code], ...(details ? { details } : {}) };
}

const MESSAGES: Readonly<Record<ResearchErrorCode, string>> = {
  invalid_research_id: "value is not a valid research id",
  invalid_entity_version: "value is not a valid entity version",
  version_conflict: "expected version does not match the current version",
  invalid_actor: "actor is missing or malformed",
  invalid_authority_level: "authority level is unknown",
  authority_conflict: "authority transition is not allowed",
  invalid_timestamp: "timestamp is not a valid UTC instant",
  invalid_source: "research source is missing required fields",
  canonicalization_failed: "value cannot be canonically serialized",
  invalid_project: "research project is missing or malformed",
  invalid_artifact: "research artifact is missing or malformed",
  invalid_artifact_kind: "artifact kind is unknown",
  invalid_content_reference: "content reference is missing or malformed",
  unsafe_relative_path: "project-relative path is unsafe",
  invalid_revision: "artifact revision is missing or malformed",
  invalid_revision_parent: "artifact revision parent is invalid",
  revision_not_found: "artifact revision was not found",
  artifact_tombstoned: "research artifact is tombstoned",
  invalid_research_brief: "research brief is missing or malformed",
  invalid_research_stage: "research stage is unknown",
  invalid_scope_rule: "scope rule is missing or malformed",
  scope_rule_conflict: "allowed and forbidden scope rules conflict",
  invalid_expected_delta: "expected delta is missing or malformed",
  invalid_evidence_boundary: "evidence boundary is missing or malformed",
  invalid_brief_change: "brief change proposal is missing or malformed",
  brief_change_not_found: "brief change proposal was not found",
  user_confirmation_required: "an explicit user confirmation is required",
  brief_change_already_decided: "brief change proposal is already decided",
  invalid_research_decision: "research decision is missing or malformed",
  invalid_decision_scope: "decision scope is missing or malformed",
  invalid_decision_status: "decision status is unknown",
  invalid_decision_transition: "decision status transition is not allowed",
  user_decision_required: "an explicit user decision is required",
  decision_supersede_required: "conflicting decisions require explicit supersede",
  invalid_research_issue: "research issue is missing or malformed",
  invalid_issue_kind: "issue kind is unknown",
  invalid_issue_fingerprint: "issue fingerprint input is missing or malformed",
  invalid_issue_transition: "issue status transition is not allowed",
  issue_reopen_not_allowed: "no issue reopen condition is satisfied",
  user_issue_action_required: "an explicit user issue action is required",
  invalid_revision_episode: "revision episode is missing or malformed",
  invalid_episode_status: "revision episode status is unknown",
  invalid_episode_transition: "revision episode transition is not allowed",
  invalid_episode_outcome: "episode outcome is missing or malformed",
  episode_lock_mismatch: "episode locked start state does not match its original lock",
  stale_episode_brief: "the active brief no longer matches the episode lock",
  user_episode_action_required: "an explicit user episode action is required",
  invalid_episode_waiver: "episode waiver is missing or malformed",
  invalid_research_snapshot: "research snapshot is missing or malformed",
  snapshot_hash_mismatch: "research snapshot content hash does not match",
  invalid_pagination: "research repository page request is invalid",
  research_record_not_found: "research record was not found in the requested project",
  research_storage_unavailable: "research storage is unavailable",
  research_storage_readonly: "research storage is read-only",
  invalid_claim: "claim is missing or malformed",
  invalid_mechanism_link: "mechanism link is missing or malformed",
  invalid_argument_delta: "argument delta is missing or malformed",
};
