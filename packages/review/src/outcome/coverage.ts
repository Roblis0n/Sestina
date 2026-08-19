import type { Finding } from "../finding.js";
import { cloneReviewValue } from "../review-result.js";
import type { ReviewObligation } from "./obligation.js";

export const COVERAGE_STATUSES = ["checked_satisfied", "checked_violated", "unproven", "not_applicable", "waived", "stale", "disputed", "checker_failed"] as const;
export type CoverageStatus = typeof COVERAGE_STATUSES[number];
export interface ObligationAssessment { readonly obligationId: string; readonly status: CoverageStatus; readonly findingIds: readonly string[]; readonly explanation?: string; }
export interface ObligationCoverage extends ObligationAssessment { readonly explanation: string; }

export function deriveCoverage(obligations: readonly ReviewObligation[], assessments: readonly ObligationAssessment[], findings: readonly Finding[]): readonly ObligationCoverage[] {
  const findingIds = new Set(findings.map((finding) => finding.id));
  const byObligation = new Map<string, ObligationAssessment>();
  for (const assessment of assessments) {
    if (!COVERAGE_STATUSES.includes(assessment.status) || byObligation.has(assessment.obligationId) || assessment.findingIds.some((id) => !findingIds.has(id))) throw new Error("Invalid obligation assessment");
    byObligation.set(assessment.obligationId, assessment);
  }
  const obligationIds = new Set(obligations.map((item) => item.id));
  if ([...byObligation.keys()].some((id) => !obligationIds.has(id))) throw new Error("Assessment names an unknown obligation");
  return cloneReviewValue(obligations.map((obligation) => {
    const assessment = byObligation.get(obligation.id);
    const explanation = assessment?.explanation?.trim();
    return assessment
      ? { ...assessment, findingIds: [...new Set(assessment.findingIds)].sort(), explanation: explanation && explanation.length > 0 ? explanation : `Coverage recorded as ${assessment.status}` }
      : { obligationId: obligation.id, status: "unproven" as const, findingIds: [], explanation: "No checker result proved or disproved this obligation" };
  }));
}
