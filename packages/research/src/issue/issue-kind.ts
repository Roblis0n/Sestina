import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type IssueKind = "target_substitution" | "repeated_audit" | "argument_leap" | "pseudo_depth" | "evidence_boundary" | "scope_violation" | "decision_violation" | "factual_error" | "methodological";
export const ISSUE_KINDS: readonly IssueKind[] = ["target_substitution", "repeated_audit", "argument_leap", "pseudo_depth", "evidence_boundary", "scope_violation", "decision_violation", "factual_error", "methodological"];
export function parseIssueKind(value: unknown): ResearchResult<IssueKind> {
  return typeof value === "string" && ISSUE_KINDS.includes(value as IssueKind)
    ? ok(value as IssueKind)
    : err(researchError("invalid_issue_kind"));
}
