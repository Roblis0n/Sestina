import { parseResearchIdFor } from "@sestina/research";
import type { StableTextDocument, StableTextSpan } from "../stable-text-span.js";
import { validateStableTextSpan } from "../stable-text-span.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";
import { parseMinimalRecovery, type MinimalRecoveryAction, type StructuredSemanticRubric } from "./shared-intent.js";

export interface SuppliedDecisionContext { readonly id: string; readonly status: "accepted" | "frozen"; readonly scope: string; readonly statement: string; }
export type DecisionConflictRelationship = "reintroduces_frozen_content" | "replaces_research_question" | "changes_sample_or_data_definition" | "changes_theoretical_basis" | "changes_conclusion_level" | "turns_preference_into_fact" | "promotes_local_decision_project_wide";
export interface DecisionConflict { readonly decisionId: string; readonly decisionStatus: "accepted" | "frozen"; readonly decisionScope: string; readonly relationship: DecisionConflictRelationship; readonly candidateSpan: StableTextSpan; }
export interface DecisionIntegrityAssessment {
  readonly criterionId: "decision-integrity";
  readonly verdict: "preserved" | "conflict" | "unknown";
  readonly conflicts: readonly DecisionConflict[];
  readonly rationale: string;
  readonly missingDecisionContext?: true;
  readonly minimalRecovery: MinimalRecoveryAction;
  readonly authority: "proposal_only";
  readonly allowedEffect: "finding_proposal_only";
}

export const DECISION_INTEGRITY_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({ id: "decision-integrity", question: "Does the candidate conflict with an explicitly supplied active or frozen research decision?", allowedKinds: ["decision_integrity"] as const, requiredEvidence: "candidate", scale: ["preserved", "conflict", "unknown"] }),
  requiredQuestions: ["Which supplied decision ID applies?", "What is its status and scope?", "Which candidate span conflicts?", "What is the precise conflict relationship?"],
  hardNegatives: ["A legal local application of an accepted or frozen decision", "A change with no supplied decision context, which must remain unknown"],
  unknownConditions: ["The referenced private decision was not supplied", "The applicable decision scope is unavailable"],
  minimalRecoveryFormat: { action: "remove or narrow the conflicting change", resumeTarget: "the locked research decision" },
  forbiddenHeuristics: ["guess private decisions", "modify or freeze a Decision", "promote a local decision to project scope"],
});

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 2_000; }
function array(value: unknown): value is readonly unknown[] { return Array.isArray(value); }

export function validateDecisionIntegrityAssessment(input: unknown, suppliedInput: readonly SuppliedDecisionContext[], candidate: StableTextDocument): SemanticReviewResult<DecisionIntegrityAssessment> {
  if (!record(input) || !array(suppliedInput)) return semanticReviewErr("invalid_response");
  const required = ["criterionId", "verdict", "conflicts", "rationale", "minimalRecovery"];
  if (!required.every((key) => key in input) || Object.keys(input).some((key) => !required.includes(key) && key !== "missingDecisionContext") || input.criterionId !== "decision-integrity" || !["preserved", "conflict", "unknown"].includes(String(input.verdict)) || !array(input.conflicts) || !text(input.rationale) || (input.missingDecisionContext !== undefined && input.missingDecisionContext !== true)) return semanticReviewErr("invalid_response");
  const supplied = new Map<string, SuppliedDecisionContext>();
  for (const raw of suppliedInput) { const id = parseResearchIdFor(raw.id, "rdec_"); if (!id.ok || supplied.has(id.value.id) || !["accepted", "frozen"].includes(raw.status) || !text(raw.scope) || !text(raw.statement)) return semanticReviewErr("invalid_request"); supplied.set(id.value.id, raw); }
  const conflicts: DecisionConflict[] = [];
  const relationships: readonly DecisionConflictRelationship[] = ["reintroduces_frozen_content", "replaces_research_question", "changes_sample_or_data_definition", "changes_theoretical_basis", "changes_conclusion_level", "turns_preference_into_fact", "promotes_local_decision_project_wide"];
  const relationship = (value: unknown): value is DecisionConflictRelationship => typeof value === "string" && relationships.some((item) => item === value);
  for (const raw of input.conflicts) {
    if (!record(raw) || Object.keys(raw).sort().join("|") !== "candidateSpan|decisionId|decisionScope|decisionStatus|relationship" || typeof raw.decisionId !== "string" || !relationship(raw.relationship)) return semanticReviewErr("invalid_response");
    const known = supplied.get(raw.decisionId); if (known === undefined || raw.decisionStatus !== known.status || raw.decisionScope !== known.scope) return semanticReviewErr("invalid_response");
    const span = validateStableTextSpan(raw.candidateSpan, candidate); if (!span.ok) return span;
    conflicts.push(Object.freeze({ decisionId: known.id, decisionStatus: known.status, decisionScope: known.scope, relationship: raw.relationship, candidateSpan: span.value }));
  }
  const verdict = input.verdict as DecisionIntegrityAssessment["verdict"];
  if ((verdict === "conflict") !== (conflicts.length > 0) || (verdict === "unknown") !== (input.missingDecisionContext === true) || (verdict === "preserved" && conflicts.length > 0)) return semanticReviewErr("invalid_response");
  const recovery = parseMinimalRecovery(input.minimalRecovery); if (!recovery.ok) return recovery;
  return semanticReviewOk(Object.freeze({ criterionId: "decision-integrity" as const, verdict, conflicts: Object.freeze(conflicts), rationale: input.rationale.trim(), ...(input.missingDecisionContext === true ? { missingDecisionContext: true as const } : {}), minimalRecovery: recovery.value, authority: "proposal_only" as const, allowedEffect: "finding_proposal_only" as const }));
}
