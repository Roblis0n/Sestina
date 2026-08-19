import type { ReviewContext } from "../review-context.js";
import { cloneReviewValue } from "../review-result.js";
import { reviewFingerprint } from "../checkers/fingerprint.js";

export type OutcomeDimension = "fulfillment" | "evidence" | "scope" | "decision_integrity" | "issue_integrity";
export type ObligationSource =
  | { readonly kind: "brief"; readonly id: string }
  | { readonly kind: "decision"; readonly id: string }
  | { readonly kind: "issue"; readonly id: string }
  | { readonly kind: "user"; readonly id: string };
export interface ReviewObligation {
  readonly id: string; readonly dimension: OutcomeDimension; readonly criterion: string;
  readonly source: ObligationSource; readonly required: boolean;
}
export interface UserReviewCheck { readonly id: string; readonly dimension: OutcomeDimension; readonly criterion: string; readonly required?: boolean; }

function obligation(dimension: OutcomeDimension, criterion: string, source: ObligationSource, required = true): ReviewObligation {
  return { id: `robl_${reviewFingerprint({ dimension, criterion, source }).slice(0, 26)}`, dimension, criterion, source, required };
}

export function deriveReviewObligations(context: ReviewContext, userChecks: readonly UserReviewCheck[]): readonly ReviewObligation[] {
  const values: ReviewObligation[] = [
    obligation("fulfillment", "Fulfill the locked Research Brief version", { kind: "brief", id: context.briefVersion.id }),
    obligation("scope", "Stay within the locked Research Brief revision scope", { kind: "brief", id: context.briefVersion.id }),
    ...context.evidenceBoundaries.map((boundary) => obligation("evidence", boundary.statement, { kind: "brief", id: boundary.id })),
    ...context.activeDecisions.map((decision) => obligation("decision_integrity", `Preserve active Decision ${decision.id} at version ${decision.version}`, { kind: "decision", id: decision.id })),
    ...context.relevantIssues.map((issue) => obligation("issue_integrity", `Address relevant Issue ${issue.id} without unauthorized state changes`, { kind: "issue", id: issue.id })),
  ];
  for (const check of userChecks) {
    if (typeof check.id !== "string" || check.id.trim().length === 0 || typeof check.criterion !== "string" || check.criterion.trim().length === 0 || !["fulfillment", "evidence", "scope", "decision_integrity", "issue_integrity"].includes(check.dimension)) throw new Error("Invalid user review check");
    values.push(obligation(check.dimension, check.criterion.trim(), { kind: "user", id: check.id.trim() }, check.required !== false));
  }
  const unique = new Map(values.map((value) => [value.id, value]));
  return cloneReviewValue([...unique.values()].sort((a, b) => a.dimension.localeCompare(b.dimension) || a.id.localeCompare(b.id)));
}
