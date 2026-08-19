import type { StableTextDocument, StableTextSpan } from "../stable-text-span.js";
import { validateStableTextSpan } from "../stable-text-span.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";
import { parseMinimalRecovery, type MinimalRecoveryAction, type StructuredSemanticRubric } from "./shared-intent.js";

export interface ShallowAbstractionAssessment {
  readonly verdict: "shallow_abstraction" | "not_shallow" | "unknown";
  readonly candidateEvidence: readonly StableTextSpan[];
  readonly missingRelations: readonly string[];
  readonly rationale: string;
  readonly minimalRecovery: MinimalRecoveryAction;
}

export const SHALLOW_ABSTRACTION_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({ id: "shallow-abstraction", question: "Which required relation is absent despite abstract language?", allowedKinds: ["shallow_abstraction"] as const, requiredEvidence: "candidate", scale: ["shallow_abstraction", "not_shallow", "unknown"] }),
  requiredQuestions: ["Which candidate span appears abstract?", "Which claim, mechanism, evidence, boundary, or alternative relation is missing?", "What single relation would repair it?"],
  hardNegatives: ["Plain or short language that completes a mechanism", "A concise boundary condition", "A concrete relation with few theory terms"],
  unknownConditions: ["The expected relation is not supplied", "No candidate span can be bound"],
  minimalRecoveryFormat: { action: "add the named missing relation", resumeTarget: "the current argument" },
  forbiddenHeuristics: ["theory-term count", "sentence length", "vocabulary rarity", "single academic depth score"],
});

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function validateShallowAbstractionAssessment(input: unknown, candidate: StableTextDocument): SemanticReviewResult<ShallowAbstractionAssessment> {
  const keys = ["verdict", "candidateEvidence", "missingRelations", "rationale", "minimalRecovery"];
  if (!record(input) || Object.keys(input).sort().join("|") !== [...keys].sort().join("|") || !["shallow_abstraction", "not_shallow", "unknown"].includes(String(input.verdict)) || !Array.isArray(input.candidateEvidence) || !Array.isArray(input.missingRelations) || typeof input.rationale !== "string" || input.rationale.trim().length === 0) return semanticReviewErr("invalid_response");
  const spans: StableTextSpan[] = []; for (const raw of input.candidateEvidence) { const checked = validateStableTextSpan(raw, candidate); if (!checked.ok) return checked; spans.push(checked.value); }
  const missing: string[] = []; for (const raw of input.missingRelations) { if (typeof raw !== "string" || raw.trim().length === 0 || missing.includes(raw.trim())) return semanticReviewErr("invalid_response"); missing.push(raw.trim()); }
  if (input.verdict === "shallow_abstraction" && (spans.length === 0 || missing.length === 0)) return semanticReviewErr("invalid_response");
  if (input.verdict === "not_shallow" && missing.length > 0) return semanticReviewErr("invalid_response");
  const recovery = parseMinimalRecovery(input.minimalRecovery); if (!recovery.ok) return recovery;
  return semanticReviewOk(Object.freeze({ verdict: input.verdict as ShallowAbstractionAssessment["verdict"], candidateEvidence: Object.freeze(spans), missingRelations: Object.freeze(missing), rationale: input.rationale.trim(), minimalRecovery: recovery.value }));
}
