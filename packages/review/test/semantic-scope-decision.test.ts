import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  createStableTextDocument,
  createStableTextSpan,
  resolveScopeAssessment,
  validateDecisionIntegrityAssessment,
  validateSemanticScopeAssessment,
} from "../src/index.js";

const ids = new SequenceIdFactory(3100);
const projectId = ids.create("rprj_");
const artifactId = ids.create("rart_");
const revisionId = ids.create("rrev_");
const decisionId = ids.create("rdec_");
const document = createStableTextDocument({ projectId, artifactId, revisionId, text: "A transition keeps the target paragraph coherent. The candidate then rewrites the whole theoretical framework." });
if (!document.ok) throw new Error(document.error.code);
const transition = createStableTextSpan(document.value, 0, 48);
const framework = createStableTextSpan(document.value, 49, document.value.normalizedText.length);
if (!transition.ok || !framework.ok) throw new Error("span fixture failed");

describe("semantic scope rubric", () => {
  it("RED: distinguishes a necessary transition from scope expansion and keeps it visible", () => {
    const result = validateSemanticScopeAssessment({
      criterionId: "semantic-scope",
      category: "necessary_supporting_change",
      changedAreas: [{ target: "transition sentence", relationship: "necessary_transition", candidateSpan: transition.value }],
      rationale: "The transition must change so the requested paragraph remains coherent.",
      minimalRecovery: { action: "retain the bounded transition", resumeTarget: "requested target paragraph" },
    }, document.value);
    expect(result).toMatchObject({ ok: true, value: { category: "necessary_supporting_change", requiresUserDecision: true, autoExpandsBrief: false } });
  });

  it("rejects a whole-framework rewrite disguised as within-scope", () => {
    expect(validateSemanticScopeAssessment({
      criterionId: "semantic-scope", category: "within_scope",
      changedAreas: [{ target: "theoretical framework", relationship: "whole_framework", candidateSpan: framework.value }],
      rationale: "Only a local edit.", minimalRecovery: { action: "none", resumeTarget: "target paragraph" },
    }, document.value)).toMatchObject({ ok: false });
  });

  it("represents proposed expansion only as a Brief change proposal", () => {
    const result = validateSemanticScopeAssessment({
      criterionId: "semantic-scope", category: "scope_expansion_proposed",
      changedAreas: [{ target: "theoretical framework", relationship: "whole_framework", candidateSpan: framework.value }],
      rationale: "The candidate proposes a larger framework rewrite.",
      briefChangeProposal: { requestedScope: "whole theoretical framework", reason: "Required only if the user accepts the larger task" },
      minimalRecovery: { action: "hold the framework rewrite", resumeTarget: "current target paragraph" },
    }, document.value);
    expect(result).toMatchObject({ ok: true, value: { category: "scope_expansion_proposed", allowedEffect: "brief_change_proposal_only", autoExpandsBrief: false } });
  });

  it("gives an RI-20 deterministic violation authority over a conflicting semantic proposal", () => {
    const semantic = validateSemanticScopeAssessment({
      criterionId: "semantic-scope", category: "within_scope",
      changedAreas: [{ target: "target paragraph", relationship: "direct_target", candidateSpan: transition.value }],
      rationale: "The candidate appears local.", minimalRecovery: { action: "none", resumeTarget: "target paragraph" },
    }, document.value);
    if (!semantic.ok) throw new Error(semantic.error.code);
    expect(resolveScopeAssessment({ violation: true, code: "forbidden_path" }, semantic.value)).toEqual({
      source: "deterministic", category: "scope_violation", deterministicCode: "forbidden_path", semanticProposalIgnored: true,
    });
  });
});

describe("decision integrity rubric", () => {
  const provided = [{ id: decisionId, status: "frozen" as const, scope: "artifact", statement: "Do not replace the mechanism with a correlation claim" }];

  it("binds a frozen-decision conflict to decision ID, status, scope, relation and candidate span", () => {
    const result = validateDecisionIntegrityAssessment({
      criterionId: "decision-integrity", verdict: "conflict",
      conflicts: [{ decisionId, decisionStatus: "frozen", decisionScope: "artifact", relationship: "reintroduces_frozen_content", candidateSpan: framework.value }],
      rationale: "The candidate restores the rejected correlation-only explanation.",
      minimalRecovery: { action: "remove the correlation-only explanation", resumeTarget: "frozen mechanism boundary" },
    }, provided, document.value);
    expect(result).toMatchObject({ ok: true, value: { verdict: "conflict", authority: "proposal_only", conflicts: [{ decisionId }] } });
  });

  it("permits a legal local application of the same decision", () => {
    expect(validateDecisionIntegrityAssessment({
      criterionId: "decision-integrity", verdict: "preserved", conflicts: [],
      rationale: "The decision is applied only to the target artifact.",
      minimalRecovery: { action: "none", resumeTarget: "target artifact" },
    }, provided, document.value)).toMatchObject({ ok: true, value: { verdict: "preserved" } });
  });

  it("returns unknown instead of guessing a private decision that was not provided", () => {
    expect(validateDecisionIntegrityAssessment({
      criterionId: "decision-integrity", verdict: "unknown", conflicts: [],
      rationale: "A referenced private decision was not provided to the reviewer.",
      missingDecisionContext: true,
      minimalRecovery: { action: "request the applicable decision context", resumeTarget: "current candidate" },
    }, [], document.value)).toMatchObject({ ok: true, value: { verdict: "unknown", missingDecisionContext: true } });
  });

  it("rejects conflict IDs or scopes not present in the supplied decision context", () => {
    expect(validateDecisionIntegrityAssessment({
      criterionId: "decision-integrity", verdict: "conflict",
      conflicts: [{ decisionId: new SequenceIdFactory(9990).create("rdec_"), decisionStatus: "frozen", decisionScope: "project", relationship: "promotes_local_decision_project_wide", candidateSpan: framework.value }],
      rationale: "Guessed private decision.", minimalRecovery: { action: "change it", resumeTarget: "task" },
    }, provided, document.value)).toMatchObject({ ok: false });
  });
});
