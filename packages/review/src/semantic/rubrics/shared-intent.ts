import type { SemanticCriterion } from "../semantic-review-request.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";

export interface ResearchIntent {
  readonly object: string;
  readonly relation: string;
  readonly deliverable: string;
}

export interface MinimalRecoveryAction {
  readonly action: string;
  readonly resumeTarget: string;
}

export interface StructuredSemanticRubric {
  readonly criterion: SemanticCriterion;
  readonly requiredQuestions: readonly string[];
  readonly hardNegatives: readonly string[];
  readonly unknownConditions: readonly string[];
  readonly minimalRecoveryFormat: Readonly<{ readonly action: string; readonly resumeTarget: string }>;
  readonly forbiddenHeuristics: readonly string[];
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 1_000; }

export function parseResearchIntent(input: unknown): SemanticReviewResult<ResearchIntent> {
  if (!record(input) || Object.keys(input).sort().join("|") !== "deliverable|object|relation" || !text(input.object) || !text(input.relation) || !text(input.deliverable)) return semanticReviewErr("invalid_response");
  return semanticReviewOk(Object.freeze({ object: input.object.trim(), relation: input.relation.trim(), deliverable: input.deliverable.trim() }));
}

export function parseMinimalRecovery(input: unknown): SemanticReviewResult<MinimalRecoveryAction> {
  if (!record(input) || Object.keys(input).sort().join("|") !== "action|resumeTarget" || !text(input.action) || !text(input.resumeTarget)) return semanticReviewErr("invalid_response");
  return semanticReviewOk(Object.freeze({ action: input.action.trim(), resumeTarget: input.resumeTarget.trim() }));
}

export function summarizeSemanticFixtureRun(input: { readonly total: number; readonly parsed: number; readonly matchedExpectedLabels: number }) {
  if (![input.total, input.parsed, input.matchedExpectedLabels].every((value) => Number.isSafeInteger(value) && value >= 0) || input.parsed > input.total || input.matchedExpectedLabels > input.parsed) throw new Error("invalid semantic fixture summary");
  return Object.freeze({
    execution: "fixture_only" as const,
    total: input.total,
    parsed: input.parsed,
    matchedExpectedLabels: input.matchedExpectedLabels,
    modelMetrics: "not_run" as const,
    limitation: "Fixed responses validate protocol behavior, not model accuracy." as const,
  });
}
