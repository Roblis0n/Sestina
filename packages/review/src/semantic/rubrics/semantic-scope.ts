import type { StableTextDocument, StableTextSpan } from "../stable-text-span.js";
import { validateStableTextSpan } from "../stable-text-span.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";
import { parseMinimalRecovery, type MinimalRecoveryAction, type StructuredSemanticRubric } from "./shared-intent.js";

export type SemanticScopeCategory = "within_scope" | "necessary_supporting_change" | "scope_expansion_proposed" | "scope_violation" | "unknown";
export type ScopeChangeRelationship = "direct_target" | "necessary_transition" | "adjacent_area" | "whole_framework";
export interface SemanticScopeChange { readonly target: string; readonly relationship: ScopeChangeRelationship; readonly candidateSpan: StableTextSpan; }
export interface SemanticScopeAssessment {
  readonly criterionId: "semantic-scope";
  readonly category: SemanticScopeCategory;
  readonly changedAreas: readonly SemanticScopeChange[];
  readonly rationale: string;
  readonly minimalRecovery: MinimalRecoveryAction;
  readonly briefChangeProposal?: { readonly requestedScope: string; readonly reason: string };
  readonly authority: "proposal_only";
  readonly requiresUserDecision: boolean;
  readonly autoExpandsBrief: false;
  readonly allowedEffect: "finding_proposal_only" | "brief_change_proposal_only";
}

export const SEMANTIC_SCOPE_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({ id: "semantic-scope", question: "Does the semantic effect remain within the locked Brief, require bounded support, propose expansion, violate scope, or remain unknown?", allowedKinds: ["semantic_scope_violation"] as const, requiredEvidence: "candidate", scale: ["within_scope", "necessary_supporting_change", "scope_expansion_proposed", "scope_violation", "unknown"] }),
  requiredQuestions: ["Which candidate spans changed?", "Is each change direct, a necessary transition, adjacent, or whole-framework?", "Does any change require a Brief change proposal?"],
  hardNegatives: ["A transition required to keep the target paragraph coherent", "A bounded local application of an existing decision"],
  unknownConditions: ["The semantic effect cannot be established from provided candidate spans", "The applicable Brief scope is unavailable"],
  minimalRecoveryFormat: { action: "hold or narrow the out-of-scope change", resumeTarget: "the locked Brief target" },
  forbiddenHeuristics: ["text length", "number of changed blocks", "automatic Brief expansion", "binary forced judgment"],
});

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 2_000; }

export function validateSemanticScopeAssessment(input: unknown, candidate: StableTextDocument): SemanticReviewResult<SemanticScopeAssessment> {
  if (!record(input)) return semanticReviewErr("invalid_response");
  const required = ["criterionId", "category", "changedAreas", "rationale", "minimalRecovery"];
  if (!required.every((key) => key in input) || Object.keys(input).some((key) => !required.includes(key) && key !== "briefChangeProposal") || input.criterionId !== "semantic-scope" || !["within_scope", "necessary_supporting_change", "scope_expansion_proposed", "scope_violation", "unknown"].includes(String(input.category)) || !Array.isArray(input.changedAreas) || !text(input.rationale)) return semanticReviewErr("invalid_response");
  const changes: SemanticScopeChange[] = [];
  for (const raw of input.changedAreas) {
    if (!record(raw) || Object.keys(raw).sort().join("|") !== "candidateSpan|relationship|target" || !text(raw.target) || !["direct_target", "necessary_transition", "adjacent_area", "whole_framework"].includes(String(raw.relationship))) return semanticReviewErr("invalid_response");
    const span = validateStableTextSpan(raw.candidateSpan, candidate); if (!span.ok) return span;
    changes.push(Object.freeze({ target: raw.target.trim(), relationship: raw.relationship as ScopeChangeRelationship, candidateSpan: span.value }));
  }
  const category = input.category as SemanticScopeCategory;
  if (category !== "unknown" && changes.length === 0) return semanticReviewErr("invalid_response");
  if (category === "within_scope" && changes.some((item) => item.relationship === "adjacent_area" || item.relationship === "whole_framework")) return semanticReviewErr("invalid_response");
  if (category === "necessary_supporting_change" && changes.some((item) => item.relationship !== "necessary_transition")) return semanticReviewErr("invalid_response");
  let briefChangeProposal: SemanticScopeAssessment["briefChangeProposal"];
  if (input.briefChangeProposal !== undefined) {
    if (!record(input.briefChangeProposal) || Object.keys(input.briefChangeProposal).sort().join("|") !== "reason|requestedScope" || !text(input.briefChangeProposal.requestedScope) || !text(input.briefChangeProposal.reason)) return semanticReviewErr("invalid_response");
    briefChangeProposal = Object.freeze({ requestedScope: input.briefChangeProposal.requestedScope.trim(), reason: input.briefChangeProposal.reason.trim() });
  }
  if ((category === "scope_expansion_proposed") !== (briefChangeProposal !== undefined)) return semanticReviewErr("invalid_response");
  const recovery = parseMinimalRecovery(input.minimalRecovery); if (!recovery.ok) return recovery;
  return semanticReviewOk(Object.freeze({
    criterionId: "semantic-scope" as const, category, changedAreas: Object.freeze(changes), rationale: input.rationale.trim(), minimalRecovery: recovery.value,
    ...(briefChangeProposal ? { briefChangeProposal } : {}), authority: "proposal_only" as const,
    requiresUserDecision: category !== "within_scope" && category !== "unknown", autoExpandsBrief: false as const,
    allowedEffect: category === "scope_expansion_proposed" ? "brief_change_proposal_only" as const : "finding_proposal_only" as const,
  }));
}

export type DeterministicScopeResult = { readonly violation: true; readonly code: string } | { readonly violation: false };
export type ResolvedScopeAssessment =
  | { readonly source: "deterministic"; readonly category: "scope_violation"; readonly deterministicCode: string; readonly semanticProposalIgnored: true }
  | { readonly source: "semantic"; readonly category: SemanticScopeCategory; readonly proposal: SemanticScopeAssessment };

export function resolveScopeAssessment(deterministic: DeterministicScopeResult, semantic: SemanticScopeAssessment): ResolvedScopeAssessment {
  if (deterministic.violation) return Object.freeze({ source: "deterministic", category: "scope_violation", deterministicCode: deterministic.code, semanticProposalIgnored: true });
  return Object.freeze({ source: "semantic", category: semantic.category, proposal: semantic });
}
