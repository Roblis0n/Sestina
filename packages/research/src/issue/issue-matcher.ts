import { isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { createIssueFingerprint, normalizeIssueFingerprintInput } from "./issue-fingerprint.js";
import type { IssueReopenContext } from "./reopen-condition.js";
import { evaluateIssueReopenReasons } from "./reopen-condition.js";
import { parseResearchIssue, type ResearchIssue, type ResearchIssueInput } from "./research-issue.js";

export type IssueMatch =
  | { readonly kind: "new" }
  | { readonly kind: "same_open"; readonly issueId: string }
  | { readonly kind: "suppressed_resolved"; readonly issueId: string }
  | { readonly kind: "eligible_to_reopen"; readonly issueId: string; readonly reasons: readonly string[] }
  | { readonly kind: "related_but_distinct"; readonly issueId: string; readonly distinction: string };

export function matchResearchIssue(candidateInput: ResearchIssueInput, issuesInput: readonly ResearchIssue[], context: IssueReopenContext = {}): ResearchResult<IssueMatch> {
  if (!isRecord(candidateInput) || !Array.isArray(issuesInput)) return err(researchError("invalid_research_issue"));
  const projectId = parseResearchIdFor(candidateInput.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const normalized = normalizeIssueFingerprintInput(candidateInput); if (!normalized.ok) return normalized;
  const fingerprint = createIssueFingerprint(candidateInput); if (!fingerprint.ok) return fingerprint;
  let related: ResearchIssue | undefined;
  for (const value of issuesInput) {
    const issue = parseResearchIssue(value); if (!issue.ok) return issue;
    if (issue.value.projectId !== projectId.value.id) continue;
    if (issue.value.fingerprint === fingerprint.value) {
      if (["open", "acknowledged", "disputed", "reopened"].includes(issue.value.status)) return ok({ kind: "same_open", issueId: issue.value.id });
      if (issue.value.status === "waived") return ok({ kind: "related_but_distinct", issueId: issue.value.id, distinction: "waived_by_user" });
      if (issue.value.status === "resolved" || issue.value.status === "suppressed") {
        const reasons = evaluateIssueReopenReasons(issue.value.resolution, context); if (!reasons.ok) return reasons;
        return reasons.value.length > 0
          ? ok({ kind: "eligible_to_reopen", issueId: issue.value.id, reasons: reasons.value })
          : ok({ kind: "suppressed_resolved", issueId: issue.value.id });
      }
    }
    const existing = normalizeIssueFingerprintInput(issue.value); if (!existing.ok) return existing;
    if (existing.value.kind === normalized.value.kind && existing.value.violatedCriterion === normalized.value.violatedCriterion && JSON.stringify(existing.value.rationaleConcepts) === JSON.stringify(normalized.value.rationaleConcepts) && existing.value.sourceArtifactId === normalized.value.sourceArtifactId && existing.value.lineageRootRevisionId === normalized.value.lineageRootRevisionId && existing.value.targetKey !== normalized.value.targetKey) related = issue.value;
  }
  return related === undefined
    ? ok({ kind: "new" })
    : ok({ kind: "related_but_distinct", issueId: related.id, distinction: "different_target_scope" });
}
