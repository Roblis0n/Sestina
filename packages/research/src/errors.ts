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
  | "artifact_tombstoned";

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
};
