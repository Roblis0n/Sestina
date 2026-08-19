import type { Finding } from "../finding.js";
import { cloneReviewValue } from "../review-result.js";
import type { ObligationCoverage } from "./coverage.js";
import { deriveCoverage } from "./coverage.js";
import { isBlockingCoverageStatus } from "./severity-policy.js";
import type { OutcomeDimension, ReviewObligation } from "./obligation.js";

export type UserReviewDisposition = "pending" | "accepted" | "rejected" | "waived";
export interface DimensionOutcome {
  readonly coverage: readonly ObligationCoverage[]; readonly obligationIds: readonly string[]; readonly findingIds: readonly string[];
  readonly satisfiedCount: number; readonly waivedCount: number; readonly notApplicableCount: number;
}
export interface ReviewOutcome {
  readonly dimensions: {
    readonly fulfillment: DimensionOutcome; readonly evidence: DimensionOutcome; readonly scope: DimensionOutcome;
    readonly decisionIntegrity: DimensionOutcome; readonly issueIntegrity: DimensionOutcome;
  };
  readonly checkerHealth: { readonly status: "healthy" | "checker_failed"; readonly failedCheckerIds: readonly string[]; readonly missingCheckerIds: readonly string[]; readonly findingIds: readonly string[] };
  readonly userDisposition: UserReviewDisposition;
  readonly reviewReady: boolean;
  readonly foregroundFindingIds: readonly string[];
  readonly auditFindingIds: readonly string[];
}

function dimensionOutcome(dimension: OutcomeDimension, obligations: readonly ReviewObligation[], coverage: readonly ObligationCoverage[]): DimensionOutcome {
  const ids = new Set(obligations.filter((item) => item.dimension === dimension).map((item) => item.id));
  const values = coverage.filter((item) => ids.has(item.obligationId));
  return {
    coverage: values, obligationIds: [...ids].sort(), findingIds: [...new Set(values.flatMap((item) => item.findingIds))].sort(),
    satisfiedCount: values.filter((item) => item.status === "checked_satisfied").length,
    waivedCount: values.filter((item) => item.status === "waived").length,
    notApplicableCount: values.filter((item) => item.status === "not_applicable").length,
  };
}

export function deriveReviewOutcome(input: {
  readonly obligations: readonly ReviewObligation[]; readonly coverage: readonly ObligationCoverage[]; readonly findings: readonly Finding[];
  readonly expectedCheckerIds: readonly string[]; readonly completedCheckerIds?: readonly string[]; readonly failedCheckerIds: readonly string[];
  readonly userDisposition: UserReviewDisposition;
}): ReviewOutcome {
  const normalizedCoverage = deriveCoverage(input.obligations, input.coverage, input.findings);
  const expected = [...new Set(input.expectedCheckerIds)].sort(); const failed = new Set(input.failedCheckerIds);
  for (const finding of input.findings) if (finding.kind === "checker_error") failed.add(finding.checker.id);
  const completed = input.completedCheckerIds ? new Set(input.completedCheckerIds) : new Set(expected.filter((id) => !failed.has(id)));
  const missing = expected.filter((id) => !completed.has(id) && !failed.has(id));
  const failedIds = [...failed].sort();
  const checkerFindingIds = input.findings.filter((finding) => finding.kind === "checker_error").map((finding) => finding.id).sort();
  const required = new Set(input.obligations.filter((item) => item.required).map((item) => item.id));
  const blocked = normalizedCoverage.some((item) => required.has(item.obligationId) && isBlockingCoverageStatus(item.status));
  const checkerFailed = failedIds.length > 0 || missing.length > 0;
  return cloneReviewValue({
    dimensions: {
      fulfillment: dimensionOutcome("fulfillment", input.obligations, normalizedCoverage),
      evidence: dimensionOutcome("evidence", input.obligations, normalizedCoverage),
      scope: dimensionOutcome("scope", input.obligations, normalizedCoverage),
      decisionIntegrity: dimensionOutcome("decision_integrity", input.obligations, normalizedCoverage),
      issueIntegrity: dimensionOutcome("issue_integrity", input.obligations, normalizedCoverage),
    },
    checkerHealth: { status: checkerFailed ? "checker_failed" as const : "healthy" as const, failedCheckerIds: failedIds, missingCheckerIds: missing, findingIds: checkerFindingIds },
    userDisposition: input.userDisposition,
    reviewReady: !blocked && !checkerFailed,
    foregroundFindingIds: input.findings.filter((finding) => finding.presentation === "foreground").map((finding) => finding.id).sort(),
    auditFindingIds: input.findings.filter((finding) => finding.presentation !== "foreground").map((finding) => finding.id).sort(),
  });
}
