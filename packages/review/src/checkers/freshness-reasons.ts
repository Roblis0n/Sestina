export const FRESHNESS_REASONS = [
  "brief_superseded",
  "candidate_parent_mismatch",
  "artifact_advanced",
  "review_input_mismatch",
  "checker_version_missing",
  "cross_project_reference",
] as const;

export type FreshnessReason = typeof FRESHNESS_REASONS[number];

export const FRESHNESS_RECOVERY: Readonly<Record<FreshnessReason, string>> = {
  brief_superseded: "Refresh the Brief binding and re-run the review",
  candidate_parent_mismatch: "Rebind the candidate to the locked baseline and re-run the review",
  artifact_advanced: "Refresh the artifact revision and re-run the review",
  review_input_mismatch: "Refresh the bound report input hash and re-run the review",
  checker_version_missing: "Restore the locked checker/build environment and re-run the review",
  cross_project_reference: "Rebind every review input to the selected project and re-run the review",
};

export const FRESHNESS_RATIONALE: Readonly<Record<FreshnessReason, string>> = {
  brief_superseded: "The current Brief version differs from the version locked for this review",
  candidate_parent_mismatch: "The candidate parent is not the baseline locked by the Episode",
  artifact_advanced: "The artifact active revision changed while the review was bound",
  review_input_mismatch: "The bound report hash differs from the canonical ReviewContext input hash",
  checker_version_missing: "A locked checker version or environment/build fingerprint is unavailable",
  cross_project_reference: "At least one locked review input belongs to a different project or Episode",
};
