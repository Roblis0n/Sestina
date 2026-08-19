import type { StableTextDocument, StableTextSpan } from "../stable-text-span.js";
import { validateStableTextSpan } from "../stable-text-span.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";
import { parseMinimalRecovery, parseResearchIntent, type MinimalRecoveryAction, type ResearchIntent, type StructuredSemanticRubric } from "./shared-intent.js";

export type IntentRelationship = "implement" | "support" | "adjacent" | "substitute";
export type FocusSubstitutionVerdict = "focus_substitution" | "no_substitution" | "unknown";

export interface FocusSubstitutionAssessment {
  readonly criterionId: "focus-substitution";
  readonly verdict: FocusSubstitutionVerdict;
  readonly originalTarget: ResearchIntent;
  readonly candidateFocus: ResearchIntent;
  readonly relationship: IntentRelationship;
  readonly originalDirectlyCompleted: boolean | "unknown";
  readonly candidateEvidence: readonly StableTextSpan[];
  readonly substitutionProjection: string;
  readonly minimalRecovery: MinimalRecoveryAction;
  readonly uncertainty?: string;
}

export const FOCUS_SUBSTITUTION_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({ id: "focus-substitution", question: "Did the candidate replace the Brief's target object, relation, or deliverable with an adjacent target?", allowedKinds: ["focus_substitution"] as const, requiredEvidence: "candidate", scale: ["focus_substitution", "no_substitution", "unknown"] }),
  requiredQuestions: ["What are the Brief's target object, relation, and deliverable?", "What does the candidate mainly address?", "Is the relation implement, support, adjacent, or substitute?", "Is the original target directly completed?", "Which minimum candidate span proves the classification?", "Project original target → candidate target in one sentence."],
  hardNegatives: ["A necessary implementation change that directly completes the target", "A bounded supporting addition while the original deliverable remains completed", "A normal extension that adds relevant information without replacing the target"],
  unknownConditions: ["The Brief target is not provided", "No candidate span can establish the primary target", "The implementation/support relationship cannot be distinguished"],
  minimalRecoveryFormat: { action: "remove or demote the substituting passage", resumeTarget: "the original Brief deliverable" },
  forbiddenHeuristics: ["keyword overlap", "candidate length", "presence of new information", "theory-term count", "vague not-on-topic labels"],
});

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function validateFocusSubstitutionAssessment(input: unknown, candidate: StableTextDocument): SemanticReviewResult<FocusSubstitutionAssessment> {
  if (!record(input)) return semanticReviewErr("invalid_response");
  const required = ["criterionId", "verdict", "originalTarget", "candidateFocus", "relationship", "originalDirectlyCompleted", "candidateEvidence", "substitutionProjection", "minimalRecovery"];
  if (!required.every((key) => key in input) || Object.keys(input).some((key) => !required.includes(key) && key !== "uncertainty") || input.criterionId !== "focus-substitution" || !["focus_substitution", "no_substitution", "unknown"].includes(String(input.verdict)) || !["implement", "support", "adjacent", "substitute"].includes(String(input.relationship)) || ![true, false, "unknown"].includes(input.originalDirectlyCompleted as never) || typeof input.substitutionProjection !== "string" || input.substitutionProjection.length > 1_000 || !input.substitutionProjection.includes("→") || (input.uncertainty !== undefined && (typeof input.uncertainty !== "string" || input.uncertainty.trim().length === 0))) return semanticReviewErr("invalid_response");
  const original = parseResearchIntent(input.originalTarget); const focus = parseResearchIntent(input.candidateFocus); const recovery = parseMinimalRecovery(input.minimalRecovery);
  if (!original.ok || !focus.ok || !recovery.ok || !Array.isArray(input.candidateEvidence) || input.candidateEvidence.length === 0) return semanticReviewErr("invalid_response");
  const spans: StableTextSpan[] = [];
  for (const raw of input.candidateEvidence) { const span = validateStableTextSpan(raw, candidate); if (!span.ok) return span; spans.push(span.value); }
  if (input.verdict === "focus_substitution" && (input.originalDirectlyCompleted !== false || !["adjacent", "substitute"].includes(String(input.relationship)))) return semanticReviewErr("invalid_response");
  if (input.verdict === "no_substitution" && (input.originalDirectlyCompleted !== true || !["implement", "support"].includes(String(input.relationship)))) return semanticReviewErr("invalid_response");
  if (input.verdict === "unknown" && input.originalDirectlyCompleted !== "unknown") return semanticReviewErr("invalid_response");
  return semanticReviewOk(Object.freeze({
    criterionId: "focus-substitution" as const,
    verdict: input.verdict as FocusSubstitutionVerdict,
    originalTarget: original.value, candidateFocus: focus.value,
    relationship: input.relationship as IntentRelationship,
    originalDirectlyCompleted: input.originalDirectlyCompleted as boolean | "unknown",
    candidateEvidence: Object.freeze(spans), substitutionProjection: input.substitutionProjection.trim(), minimalRecovery: recovery.value,
    ...(typeof input.uncertainty === "string" ? { uncertainty: input.uncertainty.trim() } : {}),
  }));
}
