import type { IssueReopenContext, ResearchIssueInput } from "@sestina/research";
import type { CheckerResult } from "../checker.js";
import { createFinding, type Finding } from "../finding.js";
import type { ReviewContext } from "../review-context.js";
import { cloneReviewValue } from "../review-result.js";
import { findingToIssueCandidate } from "../issue/finding-to-issue-candidate.js";
import { decideFindingSuppression, type IssueLookupResult, type SuppressionDecision } from "../issue/suppression-decision.js";

export interface IssueIntegrityInput {
  readonly findings: readonly Finding[];
  readonly issueLookup: IssueLookupResult;
  readonly recordedAt: string;
  readonly reopenContext: IssueReopenContext;
  readonly candidateOverrides?: ReadonlyMap<string, ResearchIssueInput>;
}

function decisionMessage(decision: SuppressionDecision): string {
  switch (decision.kind) {
    case "new": return "No matching prior Issue exists";
    case "same_open": return `same_open:${decision.issueId}`;
    case "suppress": return `unchanged resolved Issue:${decision.issueId}`;
    case "eligible_reopen": return `${decision.issueId}:${decision.reasons.join(",")}`;
    case "related_distinct": return `${decision.issueId}:${decision.distinction}`;
    case "unknown": return decision.reason;
  }
}

export class IssueIntegrityChecker {
  readonly id = "issue-integrity"; readonly version = "1.0.0"; readonly kind = "deterministic" as const;
  readonly #input: IssueIntegrityInput;
  constructor(input: IssueIntegrityInput) { this.#input = input; }
  supports(): boolean { return true; }

  run(context: ReviewContext): Promise<CheckerResult> {
    const findings: Finding[] = []; const observations: { code: string; message: string }[] = [];
    for (const raw of this.#input.findings) {
      const mapped = findingToIssueCandidate(raw, context, this.#input.recordedAt);
      const candidate = this.#input.candidateOverrides?.get(raw.id) ?? (mapped.ok ? mapped.value.input : undefined);
      const decision: SuppressionDecision = candidate ? decideFindingSuppression(candidate, this.#input.issueLookup, this.#input.reopenContext) : { kind: "unknown", reason: "issue_match_failed" };
      observations.push({ code: decision.kind, message: decisionMessage(decision) });
      let presentation = raw.presentation; let needsUserDecision = raw.needsUserDecision; let rationale = raw.rationale; let minimumRecovery = raw.minimumRecovery;
      const issueIds = [...raw.issueIds];
      if ("issueId" in decision && !issueIds.includes(decision.issueId)) issueIds.push(decision.issueId);
      switch (decision.kind) {
        case "same_open": presentation = "audit_only"; break;
        case "suppress": presentation = "suppressed"; break;
        case "eligible_reopen": needsUserDecision = true; minimumRecovery = `User reviews reopen suggestion: ${decision.reasons.join(", ")}`; break;
        case "related_distinct": rationale = `${raw.rationale}; related but distinct: ${decision.distinction}`; break;
        case "unknown": presentation = "audit_only"; needsUserDecision = true; minimumRecovery = "Restore Issue lookup or matcher confidence before creating or merging an Issue"; break;
        case "new": break;
      }
      const updated = createFinding({ ...raw, issueIds, presentation, needsUserDecision, rationale, minimumRecovery });
      if (!updated.ok) throw new Error("Issue integration Finding construction failed");
      findings.push(updated.value);
    }
    return Promise.resolve(cloneReviewValue({ findings, observations }));
  }
}
