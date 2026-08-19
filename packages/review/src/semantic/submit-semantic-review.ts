import { parseResearchIdFor, stableResearchHash } from "@sestina/research";
import { createFinding, type Finding } from "../finding.js";
import { parseReviewRun, type ReviewRun } from "../review-run.js";
import type { SemanticFindingKind } from "./semantic-finding-kind.js";
import type { SemanticFindingProposal, SemanticReviewProposal } from "./semantic-review-response.js";
import type { SemanticReviewRequest } from "./semantic-review-request.js";
import { validateStableTextSpan, type StableTextDocument, type StableTextSpan } from "./stable-text-span.js";
import { parseUntrustedJson, semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "./untrusted-response.js";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}
function boundedText(value: unknown, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }

function parseSpanArray(raw: unknown, document: StableTextDocument, max: number, allowEmpty: boolean): SemanticReviewResult<readonly StableTextSpan[]> {
  if (!Array.isArray(raw) || raw.length > max || (!allowEmpty && raw.length === 0)) return semanticReviewErr(raw instanceof Array && raw.length > max ? "limit_exceeded" : "invalid_response");
  const spans: StableTextSpan[] = [];
  for (const value of raw) { const parsed = validateStableTextSpan(value, document); if (!parsed.ok) return parsed; spans.push(parsed.value); }
  return semanticReviewOk(spans);
}

function lineRange(document: StableTextDocument, span: StableTextSpan): { startLine: number; endLine: number } {
  const startLine = document.normalizedText.slice(0, span.start).split("\n").length;
  const endLine = document.normalizedText.slice(0, span.end).split("\n").length;
  return { startLine, endLine };
}

function verifyRequest(run: ReviewRun, request: SemanticReviewRequest): boolean {
  const base = Object.fromEntries(Object.entries(request).filter(([key]) => key !== "requestHash"));
  const hash = stableResearchHash(base);
  return hash.ok && hash.value === request.requestHash && run.id === request.reviewRunId && run.projectId === request.projectId && run.inputHash === request.inputHash && run.context.snapshot.hash === request.inputSnapshotHash;
}

export function submitSemanticReview(runInput: ReviewRun, request: SemanticReviewRequest, untrustedResponse: unknown): SemanticReviewResult<readonly Finding[]> {
  const run = parseReviewRun(runInput);
  if (!run.ok || run.value.status !== "running" || !verifyRequest(run.value, request)) return semanticReviewErr("invalid_request");
  const decoded = parseUntrustedJson(untrustedResponse, request.limits.maxResponseBytes);
  if (!decoded.ok) return decoded;
  if (!record(decoded.value) || !exact(decoded.value, ["protocolVersion", "reviewRunId", "inputHash", "inputSnapshotHash", "requestHash", "reviewer", "findings"])) return semanticReviewErr("invalid_response");
  const root = decoded.value;
  if (root.protocolVersion !== "1.0.0" || root.reviewRunId !== request.reviewRunId || root.inputHash !== request.inputHash || root.inputSnapshotHash !== request.inputSnapshotHash || root.requestHash !== request.requestHash) return semanticReviewErr("request_mismatch");
  if (!record(root.reviewer) || !exact(root.reviewer, [], ["provider", "model", "sessionId"])) return semanticReviewErr("invalid_response");
  let reviewerChars = 0;
  for (const value of Object.values(root.reviewer)) { if (typeof value !== "string" || value.trim().length === 0) return semanticReviewErr("invalid_response"); reviewerChars += value.length; }
  if (reviewerChars > request.limits.maxReviewerMetadataChars) return semanticReviewErr("limit_exceeded");
  if (!Array.isArray(root.findings)) return semanticReviewErr("invalid_response");
  if (root.findings.length > request.limits.maxFindings) return semanticReviewErr("limit_exceeded");
  const ids = new Set<string>();
  const findings: Finding[] = [];
  const knownDecisionIds = new Set(request.context.activeDecisions.map((item) => item.id));
  for (const raw of root.findings) {
    const required = ["id", "kind", "target", "baselineEvidence", "candidateEvidence", "decisionIds", "criterionId", "rationale", "minimalCorrection", "confidence"];
    if (!record(raw) || !exact(raw, required, ["uncertainty"])) return semanticReviewErr("invalid_response");
    const id = parseResearchIdFor(raw.id, "rfnd_");
    if (!id.ok || ids.has(id.value.id) || typeof raw.kind !== "string" || !request.allowedFindingKinds.includes(raw.kind as SemanticFindingKind) || typeof raw.criterionId !== "string") return semanticReviewErr("invalid_response");
    const criterion = request.criteria.find((item) => item.id === raw.criterionId && item.allowedKinds.includes(raw.kind as SemanticFindingKind));
    if (criterion === undefined || !boundedText(raw.rationale, request.limits.maxRationaleChars) || !boundedText(raw.minimalCorrection, request.limits.maxMinimalCorrectionChars) || !["low", "medium", "high"].includes(String(raw.confidence)) || (raw.uncertainty !== undefined && !boundedText(raw.uncertainty, request.limits.maxUncertaintyChars))) return semanticReviewErr(typeof raw.rationale === "string" && raw.rationale.length > request.limits.maxRationaleChars ? "limit_exceeded" : "invalid_response");
    const target = validateStableTextSpan(raw.target, request.context.candidateRevision); if (!target.ok) return target;
    const baseline = parseSpanArray(raw.baselineEvidence, request.context.baselineRevision, request.limits.maxEvidenceSpansPerFinding, criterion.requiredEvidence !== "baseline" && criterion.requiredEvidence !== "both"); if (!baseline.ok) return baseline;
    const candidate = parseSpanArray(raw.candidateEvidence, request.context.candidateRevision, request.limits.maxEvidenceSpansPerFinding, criterion.requiredEvidence !== "candidate" && criterion.requiredEvidence !== "both"); if (!candidate.ok) return candidate;
    if (!Array.isArray(raw.decisionIds) || raw.decisionIds.some((value) => typeof value !== "string" || !knownDecisionIds.has(value)) || new Set(raw.decisionIds).size !== raw.decisionIds.length) return semanticReviewErr("invalid_response");
    const toEvidence = (document: StableTextDocument, span: StableTextSpan) => ({ artifactId: span.artifactId, revisionId: span.revisionId, ...lineRange(document, span), excerptHash: span.quoteHash });
    const confidence = raw.confidence === "high" ? 1 : raw.confidence === "medium" ? 0.66 : 0.33;
    const created = createFinding({
      id: id.value.id,
      kind: raw.kind,
      severity: raw.kind === "focus_substitution" || raw.kind === "decision_integrity" ? "error" : "warning",
      target: { kind: "artifact", artifactId: target.value.artifactId },
      baselineEvidence: baseline.value.map((span) => toEvidence(request.context.baselineRevision, span)),
      candidateEvidence: candidate.value.map((span) => toEvidence(request.context.candidateRevision, span)),
      briefVersionId: request.context.brief.id,
      decisionIds: raw.decisionIds,
      issueIds: [],
      checker: { id: raw.criterionId, version: request.protocolVersion, kind: "semantic" },
      confidence: { source: "model", value: confidence },
      rationale: raw.rationale,
      minimumRecovery: raw.minimalCorrection,
      needsUserDecision: raw.kind === "semantic_scope_violation" || raw.kind === "decision_integrity",
      presentation: "foreground",
      provenance: { authority: "model_proposed", inputHash: request.inputHash },
    });
    if (!created.ok) return semanticReviewErr("invalid_response");
    ids.add(id.value.id); findings.push(created.value);
  }
  return semanticReviewOk(Object.freeze(findings));
}

export type { SemanticFindingProposal, SemanticReviewProposal };
