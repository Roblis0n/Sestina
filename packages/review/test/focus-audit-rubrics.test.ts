import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  AUDIT_HIJACKING_RUBRIC,
  FOCUS_SUBSTITUTION_RUBRIC,
  createStableTextDocument,
  createStableTextSpan,
  summarizeSemanticFixtureRun,
  validateAuditHijackingAssessment,
  validateFocusSubstitutionAssessment,
} from "../src/index.js";

const ids = new SequenceIdFactory(3000);
const document = createStableTextDocument({
  projectId: ids.create("rprj_"), artifactId: ids.create("rart_"), revisionId: ids.create("rrev_"),
  text: "The candidate replaces the mechanism explanation with a repository-wide security audit.",
});
if (!document.ok) throw new Error(document.error.code);
const evidence = createStableTextSpan(document.value, 0, document.value.normalizedText.length);
if (!evidence.ok) throw new Error(evidence.error.code);

const original = { object: "mechanism", relation: "explains outcome", deliverable: "revised mechanism paragraph" };

describe("focus substitution rubric", () => {
  it("RED: requires the original and candidate targets, relation, direct completion, span, projection and recovery", () => {
    const result = validateFocusSubstitutionAssessment({
      criterionId: FOCUS_SUBSTITUTION_RUBRIC.criterion.id,
      verdict: "focus_substitution",
      originalTarget: original,
      candidateFocus: { object: "repository security", relation: "audits all risks", deliverable: "comprehensive audit report" },
      relationship: "substitute",
      originalDirectlyCompleted: false,
      candidateEvidence: [evidence.value],
      substitutionProjection: "mechanism explanation → repository-wide security audit",
      minimalRecovery: { action: "remove the comprehensive audit", resumeTarget: "revise the mechanism paragraph" },
    }, document.value);
    expect(result).toMatchObject({ ok: true, value: { verdict: "focus_substitution", relationship: "substitute" } });
  });

  it.each([
    ["necessary implementation", "implement", true],
    ["supporting extension", "support", true],
  ] as const)("keeps %s as a hard negative", (_name, relationship, completed) => {
    const result = validateFocusSubstitutionAssessment({
      criterionId: FOCUS_SUBSTITUTION_RUBRIC.criterion.id,
      verdict: "no_substitution", originalTarget: original,
      candidateFocus: { object: "mechanism", relation: "adds a boundary condition", deliverable: "revised mechanism paragraph" },
      relationship, originalDirectlyCompleted: completed, candidateEvidence: [evidence.value],
      substitutionProjection: "mechanism explanation → mechanism explanation with bounded support",
      minimalRecovery: { action: "none", resumeTarget: "mechanism paragraph is directly completed" },
    }, document.value);
    expect(result).toMatchObject({ ok: true, value: { verdict: "no_substitution" } });
  });

  it("rejects shortcut fields and vague substitution output", () => {
    const base = {
      criterionId: FOCUS_SUBSTITUTION_RUBRIC.criterion.id, verdict: "focus_substitution",
      originalTarget: original, candidateFocus: { object: "other", relation: "mentions", deliverable: "other text" },
      relationship: "substitute", originalDirectlyCompleted: false, candidateEvidence: [evidence.value],
      substitutionProjection: "not focused", minimalRecovery: { action: "fix", resumeTarget: "task" },
    };
    expect(validateFocusSubstitutionAssessment({ ...base, keywordOverlap: 0.1 }, document.value)).toMatchObject({ ok: false });
    expect(validateFocusSubstitutionAssessment(base, document.value)).toMatchObject({ ok: false });
  });
});

describe("audit hijacking rubric", () => {
  it.each([
    ["necessary_local_check", false, false],
    ["auxiliary_risk_notice", false, false],
    ["unrelated_comprehensive_audit", true, false],
    ["user_authorized_comprehensive_audit", false, true],
  ] as const)("classifies %s without treating every check as hijacking", (classification, hijacking, authorized) => {
    const result = validateAuditHijackingAssessment({
      criterionId: AUDIT_HIJACKING_RUBRIC.criterion.id,
      classification,
      mainTask: original,
      auditTarget: { object: "repository", relation: "checks risk", deliverable: "audit note" },
      mainTaskDisplaced: hijacking,
      userAuthorizedComprehensiveAudit: authorized,
      candidateEvidence: [evidence.value],
      rationale: "The scope and authority are stated directly.",
      minimalRecovery: { action: hijacking ? "return audit to an auxiliary note" : "none", resumeTarget: "revised mechanism paragraph" },
    }, document.value);
    expect(result).toMatchObject({ ok: true, value: { isHijacking: hijacking } });
  });

  it("does not permit an unrelated comprehensive audit to generate another audit plan", () => {
    expect(validateAuditHijackingAssessment({
      criterionId: AUDIT_HIJACKING_RUBRIC.criterion.id,
      classification: "unrelated_comprehensive_audit", mainTask: original,
      auditTarget: { object: "repository", relation: "checks risk", deliverable: "audit report" },
      mainTaskDisplaced: true, userAuthorizedComprehensiveAudit: false, candidateEvidence: [evidence.value],
      rationale: "The audit replaces the requested paragraph.",
      minimalRecovery: { action: "create a new full audit plan", resumeTarget: "later" },
    }, document.value)).toMatchObject({ ok: false });
  });

  it("reports fixed fixture execution honestly without model precision or recall", () => {
    expect(summarizeSemanticFixtureRun({ total: 7, parsed: 7, matchedExpectedLabels: 7 })).toEqual({
      execution: "fixture_only", total: 7, parsed: 7, matchedExpectedLabels: 7,
      modelMetrics: "not_run", limitation: "Fixed responses validate protocol behavior, not model accuracy.",
    });
  });
});
