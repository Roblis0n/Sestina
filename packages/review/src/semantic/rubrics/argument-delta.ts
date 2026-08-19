import { parseModelProposedArgumentDelta, type ArgumentDelta } from "@sestina/research";
import type { StableTextDocument } from "../stable-text-span.js";
import { validateStableTextSpan } from "../stable-text-span.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";
import type { StructuredSemanticRubric } from "./shared-intent.js";

export interface ArgumentDeltaAssessment {
  readonly verdict: "substantive_delta" | "no_substantive_delta" | "unknown";
  readonly rationale: string;
  readonly delta?: ArgumentDelta;
}

export const ARGUMENT_DELTA_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({ id: "argument-delta", question: "What concrete claim, mechanism, evidence, boundary, alternative, or theoretical relation was added?", allowedKinds: ["argument_delta"] as const, requiredEvidence: "both", scale: ["substantive_delta", "no_substantive_delta", "unknown"] }),
  requiredQuestions: ["Which baseline gap is addressed?", "Which candidate span adds a relation?", "What exact relation was added?", "Does it support a supplied expected delta?", "What limitations remain?"],
  hardNegatives: ["Longer or more abstract wording without a relation", "Theory or citation name-drop without connection to study material", "Repetition of an existing conclusion"],
  unknownConditions: ["The baseline gap is unavailable", "The candidate addition cannot be bound to a stable span"],
  minimalRecoveryFormat: { action: "add one missing concrete relation", resumeTarget: "the expected argument delta" },
  forbiddenHeuristics: ["0-100 depth score", "text length", "theory-term count", "citation count", "language complexity"],
});

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function validateArgumentDeltaAssessment(input: unknown, baseline: StableTextDocument, candidate: StableTextDocument, options: { readonly expectedDeltaIds?: readonly string[] } = {}): SemanticReviewResult<ArgumentDeltaAssessment> {
  if (!record(input) || Object.keys(input).some((key) => !["verdict", "rationale", "delta"].includes(key)) || !["substantive_delta", "no_substantive_delta", "unknown"].includes(String(input.verdict)) || typeof input.rationale !== "string" || input.rationale.trim().length === 0 || input.rationale.length > 2_000) return semanticReviewErr("invalid_response");
  if (input.verdict === "unknown") { if (input.delta !== undefined) return semanticReviewErr("invalid_response"); return semanticReviewOk(Object.freeze({ verdict: "unknown", rationale: input.rationale.trim() })); }
  if (!record(input.delta) || !Array.isArray(input.delta.baselineGapSpans) || !Array.isArray(input.delta.candidateAdditionSpans)) return semanticReviewErr("invalid_response");
  for (const span of input.delta.baselineGapSpans) { const checked = validateStableTextSpan(span, baseline); if (!checked.ok) return checked; }
  for (const span of input.delta.candidateAdditionSpans) { const checked = validateStableTextSpan(span, candidate); if (!checked.ok) return checked; }
  const parsed = parseModelProposedArgumentDelta(input.delta); if (!parsed.ok) return semanticReviewErr("invalid_response");
  if (parsed.value.projectId !== baseline.projectId || parsed.value.projectId !== candidate.projectId || parsed.value.artifactId !== baseline.artifactId || parsed.value.artifactId !== candidate.artifactId || parsed.value.baselineRevisionId !== baseline.revisionId || parsed.value.candidateRevisionId !== candidate.revisionId) return semanticReviewErr("span_mismatch");
  if ((input.verdict === "substantive_delta") !== (parsed.value.kind !== "no_substantive_delta")) return semanticReviewErr("invalid_response");
  if (parsed.value.supportsExpectedDeltaId !== undefined && !(options.expectedDeltaIds ?? []).includes(parsed.value.supportsExpectedDeltaId)) return semanticReviewErr("invalid_response");
  return semanticReviewOk(Object.freeze({ verdict: input.verdict as "substantive_delta" | "no_substantive_delta", rationale: input.rationale.trim(), delta: parsed.value }));
}
