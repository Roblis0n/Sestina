import {
  parseArgumentClaim, parseArgumentEvidence, parseClaimEvidenceLink, parseMechanismEvidenceLink, parseMechanismLink,
  type ArgumentClaim, type ArgumentEvidence, type ClaimEvidenceLink, type MechanismEvidenceLink, type MechanismLink,
} from "@sestina/research";
import { cloneReviewValue } from "../../review-result.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "../untrusted-response.js";
import type { StructuredSemanticRubric } from "./shared-intent.js";

export type EvidenceBoundaryCode = "claim_strength_exceeds_evidence" | "background_cannot_prove_study_claim" | "user_decision_is_not_external_fact" | "stale_evidence" | "disputed_evidence" | "evidence_link_unproven" | "mechanism_step_missing" | "mechanism_evidence_missing" | "evidence_missing";
export interface EvidenceBoundaryFinding {
  readonly code: EvidenceBoundaryCode; readonly claimId: string; readonly evidenceIds: readonly string[];
  readonly linkDescription: string; readonly state: "unproven" | "stale" | "disputed";
  readonly reason: string; readonly minimumDowngrade: string; readonly minimumNeeded: string;
}
export interface EvidenceBoundaryInput {
  readonly claims: readonly ArgumentClaim[]; readonly evidence: readonly ArgumentEvidence[];
  readonly claimEvidenceLinks: readonly ClaimEvidenceLink[]; readonly mechanismLinks: readonly MechanismLink[];
  readonly mechanismEvidenceLinks: readonly MechanismEvidenceLink[];
}

export const EVIDENCE_BOUNDARY_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({ id: "evidence-boundary", question: "Does each claim stay within the registered evidence type, version, and mechanism support?", allowedKinds: ["evidence_boundary"] as const, requiredEvidence: "both", scale: ["proven", "unproven", "stale", "disputed", "unknown"] }),
  requiredQuestions: ["Which concrete claim is evaluated?", "Which registered evidence and link support it?", "Which mechanism step is missing?", "Is the evidence current?", "What is the minimum honest downgrade?"],
  hardNegatives: ["Background literature used only for context", "A current artifact span used for a descriptive claim", "A user decision represented as a preference rather than an external fact"],
  unknownConditions: ["Claim or evidence graph data is not provided", "The current revision binding is unavailable"],
  minimalRecoveryFormat: { action: "downgrade the claim or add one missing evidence/mechanism link", resumeTarget: "the current research claim" },
  forbiddenHeuristics: ["internet literature verification", "evidence shortage means false", "correlation means causation", "user preference means external fact"],
});

export function evaluateEvidenceBoundary(input: EvidenceBoundaryInput): SemanticReviewResult<{ readonly findings: readonly EvidenceBoundaryFinding[] }> {
  if (!Array.isArray(input.claims) || !Array.isArray(input.evidence) || !Array.isArray(input.claimEvidenceLinks) || !Array.isArray(input.mechanismLinks) || !Array.isArray(input.mechanismEvidenceLinks)) return semanticReviewErr("invalid_request");
  const claims = new Map<string, ArgumentClaim>(); for (const raw of input.claims) { const parsed = parseArgumentClaim(raw); if (!parsed.ok || claims.has(parsed.value.id)) return semanticReviewErr("invalid_request"); claims.set(parsed.value.id, parsed.value); }
  const evidence = new Map<string, ArgumentEvidence>(); for (const raw of input.evidence) { const parsed = parseArgumentEvidence(raw); if (!parsed.ok || evidence.has(parsed.value.id)) return semanticReviewErr("invalid_request"); evidence.set(parsed.value.id, parsed.value); }
  const links: ClaimEvidenceLink[] = []; for (const raw of input.claimEvidenceLinks) { const parsed = parseClaimEvidenceLink(raw); if (!parsed.ok || !claims.has(parsed.value.claimId) || !evidence.has(parsed.value.evidenceId)) return semanticReviewErr("invalid_request"); links.push(parsed.value); }
  const mechanisms: MechanismLink[] = []; for (const raw of input.mechanismLinks) { const parsed = parseMechanismLink(raw); if (!parsed.ok) return semanticReviewErr("invalid_request"); mechanisms.push(parsed.value); }
  const mechanismEvidence: MechanismEvidenceLink[] = []; for (const raw of input.mechanismEvidenceLinks) { const parsed = parseMechanismEvidenceLink(raw); if (!parsed.ok) return semanticReviewErr("invalid_request"); mechanismEvidence.push(parsed.value); }
  const findings: EvidenceBoundaryFinding[] = [];
  const add = (claim: ArgumentClaim, code: EvidenceBoundaryCode, evidenceIds: readonly string[], state: EvidenceBoundaryFinding["state"], reason: string, minimumDowngrade: string, minimumNeeded: string) => findings.push(Object.freeze({ code, claimId: claim.id, evidenceIds: Object.freeze([...evidenceIds]), linkDescription: `${claim.id} → ${evidenceIds.join(",") || "missing"}`, state, reason, minimumDowngrade, minimumNeeded }));
  for (const claim of claims.values()) {
    const claimLinks = links.filter((item) => item.claimId === claim.id);
    if (claimLinks.length === 0) add(claim, "evidence_missing", [], "unproven", "No registered evidence link supports the claim.", "Mark the claim as unproven.", "Add one claim–evidence link.");
    for (const link of claimLinks) {
      const item = evidence.get(link.evidenceId); if (!item) continue;
      if (item.projectId !== claim.projectId || (item.artifactId !== undefined && (item.artifactId !== claim.artifactId || item.revisionId !== claim.revisionId))) return semanticReviewErr("invalid_request");
      if (item.state === "stale" || link.status === "stale") add(claim, "stale_evidence", [item.id], "stale", "The evidence is not bound to the current data or text version.", "Describe the claim as based on an earlier version.", "Rebind evidence to the current revision.");
      else if (item.state === "disputed" || link.status === "disputed") add(claim, "disputed_evidence", [item.id], "disputed", "The registered evidence is disputed.", "State that the support is disputed.", "Resolve or replace the disputed evidence.");
      else if (link.status === "unproven") add(claim, "evidence_link_unproven", [item.id], "unproven", "The claim–evidence relation has not been proven.", "Mark the relation as proposed.", "Confirm the specific supporting relation.");
      if (link.role === "background_only" || item.inferenceCapacity === "background_only") add(claim, "background_cannot_prove_study_claim", [item.id], "unproven", "Background literature cannot prove this study's empirical conclusion.", "Present the literature as background only.", "Add evidence from the current study.");
      if (item.kind === "user_decision" && claim.kind !== "normative" && claim.kind !== "completion") add(claim, "user_decision_is_not_external_fact", [item.id], "unproven", "A user decision records authority or preference, not an external fact.", "Attribute the statement to the user's decision.", "Add external evidence for the factual claim.");
      if (claim.kind === "causal" && item.inferenceCapacity !== "causal") add(claim, "claim_strength_exceeds_evidence", [item.id], "unproven", "The registered evidence does not support causal inference.", "State an association rather than a causal effect.", "Add causal-design evidence or an identified causal mechanism.");
    }
    if ((claim.kind === "causal" || claim.kind === "mechanistic") && !mechanisms.some((item) => item.fromClaimId === claim.id || item.toClaimId === claim.id)) add(claim, "mechanism_step_missing", claimLinks.map((item) => item.evidenceId), "unproven", "No registered mechanism chain supplies the intermediate step.", "Describe the mechanism as a hypothesis.", "Add the minimum intermediate mechanism step.");
    for (const mechanism of mechanisms.filter((item) => item.fromClaimId === claim.id || item.toClaimId === claim.id)) if (!mechanismEvidence.some((item) => item.mechanismLinkId === mechanism.id && item.status === "proven")) add(claim, "mechanism_evidence_missing", [], "unproven", "The mechanism relation lacks a proven evidence link.", "Describe the mechanism as proposed.", "Link evidence to the specific mechanism step.");
  }
  findings.sort((a, b) => a.claimId.localeCompare(b.claimId) || a.code.localeCompare(b.code));
  return semanticReviewOk(cloneReviewValue({ findings }));
}
