import { parseResearchIdFor, stableResearchHash } from "@sestina/research";
import { parseReviewRun } from "../review-run.js";
import { cloneReviewValue } from "../review-result.js";
import { isSemanticFindingKind, type SemanticFindingKind } from "./semantic-finding-kind.js";
import { createStableTextDocument } from "./stable-text-span.js";
import { SEMANTIC_REVIEW_RESPONSE_SCHEMA } from "./semantic-review-schema.js";
import type { PrepareSemanticReviewInput, SemanticReviewRequest } from "./semantic-review-request.js";
import { semanticReviewErr, semanticReviewOk, type SemanticReviewResult } from "./untrusted-response.js";

const LIMITS = Object.freeze({
  maxFindings: 8,
  maxEvidenceSpansPerFinding: 8,
  maxRationaleChars: 2_000,
  maxMinimalCorrectionChars: 1_000,
  maxUncertaintyChars: 1_000,
  maxReviewerMetadataChars: 256,
  maxResponseBytes: 65_536,
});

function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function array(value: unknown): value is readonly unknown[] { return Array.isArray(value); }

export function prepareSemanticReview(input: PrepareSemanticReviewInput): SemanticReviewResult<SemanticReviewRequest> {
  const run = parseReviewRun(input.reviewRun);
  if (!run.ok || run.value.status !== "running" || !nonBlank(input.brief.projectQuestion) || !nonBlank(input.brief.currentTask) || !array(input.brief.targetArtifactIds) || !array(input.brief.fixedDecisions) || !array(input.brief.expectedDeltas) || !array(input.activeDecisions) || !array(input.criteria) || input.criteria.length === 0) return semanticReviewErr("invalid_request");
  const briefId = parseResearchIdFor(input.brief.id, "rbrf_");
  if (!briefId.ok || briefId.value.id !== run.value.context.briefVersion.id) return semanticReviewErr("invalid_request");
  const baseline = createStableTextDocument(input.baselineRevision);
  const candidate = createStableTextDocument(input.candidateRevision);
  if (!baseline.ok || !candidate.ok) return semanticReviewErr("invalid_request");
  const context = run.value.context;
  if (baseline.value.projectId !== run.value.projectId || candidate.value.projectId !== run.value.projectId || baseline.value.artifactId !== context.episode.artifactId || candidate.value.artifactId !== context.episode.artifactId || baseline.value.revisionId !== context.episode.baselineRevisionId || candidate.value.revisionId !== context.episode.candidateRevisionId) return semanticReviewErr("invalid_request");
  const lockedDecisionIds = context.activeDecisions.map((item) => item.id).sort();
  const providedDecisionIds = input.activeDecisions.map((item) => item.id).sort();
  if (lockedDecisionIds.join("|") !== providedDecisionIds.join("|") || input.activeDecisions.some((item) => !nonBlank(item.statement) || !nonBlank(item.scope) || !context.activeDecisions.some((locked) => locked.id === item.id && locked.status === item.status))) return semanticReviewErr("invalid_request");
  const criterionIds = new Set<string>();
  const kinds: SemanticFindingKind[] = [];
  for (const criterion of input.criteria) {
    if (!nonBlank(criterion.id) || criterionIds.has(criterion.id) || !nonBlank(criterion.question) || !array(criterion.allowedKinds) || criterion.allowedKinds.length === 0 || criterion.allowedKinds.some((kind) => !isSemanticFindingKind(kind)) || !["baseline", "candidate", "both"].includes(criterion.requiredEvidence) || !array(criterion.scale) || criterion.scale.length === 0 || criterion.scale.some((item) => !nonBlank(item))) return semanticReviewErr("invalid_request");
    criterionIds.add(criterion.id);
    for (const kind of criterion.allowedKinds) if (!kinds.includes(kind)) kinds.push(kind);
  }
  kinds.sort();
  const base = {
    protocolVersion: "1.0.0" as const,
    reviewRunId: run.value.id,
    projectId: run.value.projectId,
    inputHash: run.value.inputHash,
    inputSnapshotHash: context.snapshot.hash,
    context: { brief: input.brief, baselineRevision: baseline.value, candidateRevision: candidate.value, activeDecisions: input.activeDecisions },
    criteria: input.criteria,
    allowedFindingKinds: kinds,
    constraints: {
      authority: "proposal_only" as const,
      candidateTextIsUntrusted: true as const,
      forbiddenPowers: ["update_brief", "close_issue", "reopen_issue", "freeze_decision", "accept_episode", "replace_revision", "expand_audit_obligations", "claim_user_confirmation"],
    },
    limits: LIMITS,
    responseSchema: SEMANTIC_REVIEW_RESPONSE_SCHEMA as Readonly<Record<string, unknown>>,
  };
  const hash = stableResearchHash(base);
  if (!hash.ok) return semanticReviewErr("invalid_request");
  return semanticReviewOk(cloneReviewValue({ ...base, requestHash: hash.value }));
}
