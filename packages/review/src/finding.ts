import { parseResearchIdFor } from "@sestina/research";
import { parseFindingEvidenceSpan, type FindingEvidenceSpan } from "./finding-evidence.js";
import { cloneReviewValue, reviewErr, reviewError, reviewOk, type ReviewResult } from "./review-result.js";
import type { CheckerIdentity } from "./review-context.js";

export type FindingSeverity = "info" | "warning" | "error" | "critical";
export type FindingPresentation = "foreground" | "audit_only" | "suppressed";
export interface FindingTarget { readonly kind: "project" | "artifact" | "brief" | "decision" | "issue" | "path" | "block"; readonly artifactId?: string; readonly relativePath?: string; readonly blockId?: string; }
export interface FindingConfidence { readonly source: "rule" | "model" | "hybrid"; readonly value: number; }
export interface FindingProvenance { readonly authority: "system_derived" | "model_proposed"; readonly inputHash: string; }
export interface Finding {
  readonly id: string; readonly kind: string; readonly severity: FindingSeverity; readonly target: FindingTarget;
  readonly baselineEvidence: readonly FindingEvidenceSpan[]; readonly candidateEvidence: readonly FindingEvidenceSpan[];
  readonly briefVersionId: string; readonly decisionIds: readonly string[]; readonly issueIds: readonly string[];
  readonly checker: CheckerIdentity; readonly confidence: FindingConfidence; readonly rationale: string;
  readonly minimumRecovery: string; readonly needsUserDecision: boolean; readonly presentation: FindingPresentation;
  readonly provenance: FindingProvenance;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

export function createFinding(input: unknown): ReviewResult<Finding> {
  if (!record(input) || !text(input.kind) || !["info", "warning", "error", "critical"].includes(String(input.severity)) || !record(input.target) || !Array.isArray(input.baselineEvidence) || !Array.isArray(input.candidateEvidence) || !Array.isArray(input.decisionIds) || !Array.isArray(input.issueIds) || !record(input.checker) || !record(input.confidence) || !record(input.provenance) || !text(input.rationale) || !text(input.minimumRecovery) || typeof input.needsUserDecision !== "boolean" || !["foreground", "audit_only", "suppressed"].includes(String(input.presentation))) return reviewErr(reviewError("invalid_finding"));
  const id = parseResearchIdFor(input.id, "rfnd_"); const brief = parseResearchIdFor(input.briefVersionId, "rbrf_");
  if (!id.ok || !brief.ok || !text(input.checker.id) || !text(input.checker.version) || (input.checker.kind !== "deterministic" && input.checker.kind !== "semantic")) return reviewErr(reviewError("invalid_finding"));
  const target: { kind: FindingTarget["kind"]; artifactId?: string; relativePath?: string; blockId?: string } = { kind: input.target.kind as FindingTarget["kind"] };
  if (!["project", "artifact", "brief", "decision", "issue", "path", "block"].includes(target.kind)) return reviewErr(reviewError("invalid_finding"));
  if (input.target.artifactId !== undefined) { const artifact = parseResearchIdFor(input.target.artifactId, "rart_"); if (!artifact.ok) return reviewErr(reviewError("invalid_finding")); target.artifactId = artifact.value.id; }
  if (input.target.relativePath !== undefined) { if (!text(input.target.relativePath) || /^(?:[a-z]:|\\|\/)|(?:^|\/)\.\.(?:\/|$)/i.test(input.target.relativePath)) return reviewErr(reviewError("invalid_finding")); target.relativePath = input.target.relativePath; }
  if (input.target.blockId !== undefined) { if (!text(input.target.blockId)) return reviewErr(reviewError("invalid_finding")); target.blockId = input.target.blockId.trim(); }
  const spans = (values: readonly unknown[]): ReviewResult<readonly FindingEvidenceSpan[]> => { const result: FindingEvidenceSpan[] = []; for (const raw of values) { const parsed = parseFindingEvidenceSpan(raw); if (!parsed.ok) return parsed; result.push(parsed.value); } return reviewOk(result); };
  const baseline = spans(input.baselineEvidence); const candidate = spans(input.candidateEvidence); if (!baseline.ok || !candidate.ok) return reviewErr(reviewError("invalid_finding"));
  if (input.checker.kind === "semantic" && input.kind !== "checker_error" && baseline.value.length + candidate.value.length === 0) return reviewErr(reviewError("invalid_finding"));
  const ids = (values: readonly unknown[], prefix: "rdec_" | "riss_"): ReviewResult<readonly string[]> => { const result: string[] = []; for (const raw of values) { const parsed = parseResearchIdFor(raw, prefix); if (!parsed.ok || result.includes(parsed.value.id)) return reviewErr(reviewError("invalid_finding")); result.push(parsed.value.id); } return reviewOk(result); };
  const decisions = ids(input.decisionIds, "rdec_"); const issues = ids(input.issueIds, "riss_"); if (!decisions.ok || !issues.ok) return reviewErr(reviewError("invalid_finding"));
  if (!["rule", "model", "hybrid"].includes(String(input.confidence.source)) || typeof input.confidence.value !== "number" || !Number.isFinite(input.confidence.value) || input.confidence.value < 0 || input.confidence.value > 1) return reviewErr(reviewError("invalid_finding"));
  if (!["system_derived", "model_proposed"].includes(String(input.provenance.authority)) || typeof input.provenance.inputHash !== "string" || !/^[0-9a-f]{64}$/.test(input.provenance.inputHash)) return reviewErr(reviewError("invalid_finding"));
  return reviewOk(cloneReviewValue({
    id: id.value.id, kind: input.kind.trim(), severity: input.severity as FindingSeverity, target,
    baselineEvidence: baseline.value, candidateEvidence: candidate.value, briefVersionId: brief.value.id,
    decisionIds: decisions.value, issueIds: issues.value,
    checker: { id: input.checker.id.trim(), version: input.checker.version.trim(), kind: input.checker.kind },
    confidence: { source: input.confidence.source as FindingConfidence["source"], value: input.confidence.value },
    rationale: input.rationale.trim(), minimumRecovery: input.minimumRecovery.trim(), needsUserDecision: input.needsUserDecision,
    presentation: input.presentation as FindingPresentation,
    provenance: { authority: input.provenance.authority as FindingProvenance["authority"], inputHash: input.provenance.inputHash },
  }));
}

export const parseFinding = createFinding;
