import type { StableTextDocument, StableTextSpan } from "../stable-text-span.js";
import { validateStableTextSpan } from "../stable-text-span.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";
import { parseMinimalRecovery, parseResearchIntent, type MinimalRecoveryAction, type ResearchIntent, type StructuredSemanticRubric } from "./shared-intent.js";

export type AuditClassification = "necessary_local_check" | "auxiliary_risk_notice" | "unrelated_comprehensive_audit" | "user_authorized_comprehensive_audit" | "unknown";
export interface AuditHijackingAssessment {
  readonly criterionId: "audit-hijacking";
  readonly classification: AuditClassification;
  readonly mainTask: ResearchIntent;
  readonly auditTarget: ResearchIntent;
  readonly mainTaskDisplaced: boolean | "unknown";
  readonly userAuthorizedComprehensiveAudit: boolean | "unknown";
  readonly candidateEvidence: readonly StableTextSpan[];
  readonly rationale: string;
  readonly minimalRecovery: MinimalRecoveryAction;
  readonly isHijacking: boolean;
}

export const AUDIT_HIJACKING_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({ id: "audit-hijacking", question: "Did an audit obligation displace the current research deliverable without user authority?", allowedKinds: ["audit_hijacking"] as const, requiredEvidence: "candidate", scale: ["necessary_local_check", "auxiliary_risk_notice", "unrelated_comprehensive_audit", "user_authorized_comprehensive_audit", "unknown"] }),
  requiredQuestions: ["What is the current main task?", "What exact object is being audited?", "Is the check locally necessary, auxiliary, comprehensive-unrelated, or user-authorized?", "Did it displace direct completion?", "Which candidate span proves that relationship?"],
  hardNegatives: ["A local check required to complete the requested change", "A short auxiliary risk notice", "A comprehensive audit explicitly requested by the user"],
  unknownConditions: ["User authorization was not provided", "The audit extent cannot be established from candidate spans", "The main task is unavailable"],
  minimalRecoveryFormat: { action: "demote the unrelated audit to an auxiliary note", resumeTarget: "the current Brief deliverable" },
  forbiddenHeuristics: ["any external check means hijacking", "candidate length", "risk vocabulary count", "generate a new comprehensive audit plan"],
});

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function validateAuditHijackingAssessment(input: unknown, candidate: StableTextDocument): SemanticReviewResult<AuditHijackingAssessment> {
  const keys = ["criterionId", "classification", "mainTask", "auditTarget", "mainTaskDisplaced", "userAuthorizedComprehensiveAudit", "candidateEvidence", "rationale", "minimalRecovery"];
  if (!record(input) || Object.keys(input).sort().join("|") !== [...keys].sort().join("|") || input.criterionId !== "audit-hijacking" || !["necessary_local_check", "auxiliary_risk_notice", "unrelated_comprehensive_audit", "user_authorized_comprehensive_audit", "unknown"].includes(String(input.classification)) || ![true, false, "unknown"].includes(input.mainTaskDisplaced as never) || ![true, false, "unknown"].includes(input.userAuthorizedComprehensiveAudit as never) || typeof input.rationale !== "string" || input.rationale.trim().length === 0 || input.rationale.length > 2_000) return semanticReviewErr("invalid_response");
  const task = parseResearchIntent(input.mainTask); const target = parseResearchIntent(input.auditTarget); const recovery = parseMinimalRecovery(input.minimalRecovery);
  if (!task.ok || !target.ok || !recovery.ok || !Array.isArray(input.candidateEvidence) || input.candidateEvidence.length === 0) return semanticReviewErr("invalid_response");
  const spans: StableTextSpan[] = [];
  for (const raw of input.candidateEvidence) { const span = validateStableTextSpan(raw, candidate); if (!span.ok) return span; spans.push(span.value); }
  const classification = input.classification as AuditClassification;
  const isHijacking = classification === "unrelated_comprehensive_audit" && input.mainTaskDisplaced === true && input.userAuthorizedComprehensiveAudit === false;
  if (classification === "user_authorized_comprehensive_audit" && input.userAuthorizedComprehensiveAudit !== true) return semanticReviewErr("invalid_response");
  if (["necessary_local_check", "auxiliary_risk_notice"].includes(classification) && input.mainTaskDisplaced !== false) return semanticReviewErr("invalid_response");
  if (isHijacking && /(?:create|generate|write).*(?:full|comprehensive).*audit\s+plan/i.test(recovery.value.action)) return semanticReviewErr("invalid_response");
  return semanticReviewOk(Object.freeze({ criterionId: "audit-hijacking" as const, classification, mainTask: task.value, auditTarget: target.value, mainTaskDisplaced: input.mainTaskDisplaced as boolean | "unknown", userAuthorizedComprehensiveAudit: input.userAuthorizedComprehensiveAudit as boolean | "unknown", candidateEvidence: Object.freeze(spans), rationale: input.rationale.trim(), minimalRecovery: recovery.value, isHijacking }));
}
