import { parseEntityVersion, parseResearchIdFor, stableResearchHash } from "@sestina/research";
import { cloneReviewValue, reviewErr, reviewError, reviewOk, type ReviewResult } from "./review-result.js";

export type CheckerKind = "deterministic" | "semantic";
export interface CheckerIdentity { readonly id: string; readonly version: string; readonly kind: CheckerKind; }
export interface ReviewProjectBinding { readonly id: string; readonly version: number; }
export interface ReviewEpisodeBinding { readonly id: string; readonly version: number; readonly artifactId: string; readonly baselineRevisionId: string; readonly candidateRevisionId: string; }
export interface ReviewRevisionBinding { readonly id: string; readonly artifactId: string; readonly projectId: string; readonly parentRevisionId?: string; readonly contentHash: string; }
export interface ReviewBriefBinding { readonly id: string; readonly versionNumber: number; }
export interface ReviewDecisionBinding { readonly id: string; readonly version: number; readonly status: "accepted" | "frozen"; }
export interface ReviewIssueBinding { readonly id: string; readonly version: number; readonly status: string; }
export interface ReviewEvidenceBoundaryBinding { readonly id: string; readonly statement: string; }
export interface ReviewSnapshotBinding { readonly id: string; readonly projectId: string; readonly episodeId: string; readonly hash: string; }

export interface ReviewContextInput {
  readonly project: ReviewProjectBinding;
  readonly episode: ReviewEpisodeBinding;
  readonly baselineRevision: ReviewRevisionBinding;
  readonly candidateRevision: ReviewRevisionBinding;
  readonly briefVersion: ReviewBriefBinding;
  readonly activeDecisions: readonly ReviewDecisionBinding[];
  readonly relevantIssues: readonly ReviewIssueBinding[];
  readonly evidenceBoundaries: readonly ReviewEvidenceBoundaryBinding[];
  readonly snapshot: ReviewSnapshotBinding;
  readonly checkerSet: readonly CheckerIdentity[];
  readonly environmentFingerprint: string;
  readonly buildFingerprint: string;
}

export interface ReviewContext extends ReviewContextInput { readonly inputHash: string; }

function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

export function calculateReviewInputHash(input: ReviewContextInput): string {
  const result = stableResearchHash(input);
  return result.ok ? result.value : "";
}

function parseCheckerIdentity(input: unknown): ReviewResult<CheckerIdentity> {
  if (!record(input) || !nonBlank(input.id) || !nonBlank(input.version) || (input.kind !== "deterministic" && input.kind !== "semantic")) {
    return reviewErr(reviewError("invalid_review_context"));
  }
  return reviewOk(Object.freeze({ id: input.id.trim(), version: input.version.trim(), kind: input.kind }));
}

export function parseReviewContext(input: unknown): ReviewResult<ReviewContext> {
  if (!record(input) || !record(input.project) || !record(input.episode) || !record(input.baselineRevision) || !record(input.candidateRevision) || !record(input.briefVersion) || !record(input.snapshot) || !Array.isArray(input.activeDecisions) || !Array.isArray(input.relevantIssues) || !Array.isArray(input.evidenceBoundaries) || !Array.isArray(input.checkerSet) || !hash(input.environmentFingerprint) || !hash(input.buildFingerprint) || !hash(input.inputHash)) {
    return reviewErr(reviewError("invalid_review_context"));
  }
  const projectId = parseResearchIdFor(input.project.id, "rprj_"); const projectVersion = parseEntityVersion(input.project.version);
  const episodeId = parseResearchIdFor(input.episode.id, "repi_"); const episodeVersion = parseEntityVersion(input.episode.version);
  const artifactId = parseResearchIdFor(input.episode.artifactId, "rart_");
  const baselineId = parseResearchIdFor(input.episode.baselineRevisionId, "rrev_"); const candidateId = parseResearchIdFor(input.episode.candidateRevisionId, "rrev_");
  const briefId = parseResearchIdFor(input.briefVersion.id, "rbrf_");
  if (!projectId.ok || !projectVersion.ok || !episodeId.ok || !episodeVersion.ok || !artifactId.ok || !baselineId.ok || !candidateId.ok || !briefId.ok || !Number.isSafeInteger(input.briefVersion.versionNumber) || Number(input.briefVersion.versionNumber) < 1) return reviewErr(reviewError("invalid_review_context"));
  const parseRevision = (raw: Record<string, unknown>): ReviewResult<ReviewRevisionBinding> => {
    const id = parseResearchIdFor(raw.id, "rrev_"); const artifact = parseResearchIdFor(raw.artifactId, "rart_"); const project = parseResearchIdFor(raw.projectId, "rprj_");
    let parentRevisionId: string | undefined;
    if (raw.parentRevisionId !== undefined) { const parent = parseResearchIdFor(raw.parentRevisionId, "rrev_"); if (!parent.ok) return reviewErr(reviewError("invalid_review_context")); parentRevisionId = parent.value.id; }
    if (!id.ok || !artifact.ok || !project.ok || !hash(raw.contentHash)) return reviewErr(reviewError("invalid_review_context"));
    return reviewOk(Object.freeze({ id: id.value.id, artifactId: artifact.value.id, projectId: project.value.id, ...(parentRevisionId ? { parentRevisionId } : {}), contentHash: raw.contentHash }));
  };
  const baseline = parseRevision(input.baselineRevision); const candidate = parseRevision(input.candidateRevision); if (!baseline.ok || !candidate.ok) return reviewErr(reviewError("invalid_review_context"));
  const decisions: ReviewDecisionBinding[] = [];
  for (const raw of input.activeDecisions) { if (!record(raw) || (raw.status !== "accepted" && raw.status !== "frozen")) return reviewErr(reviewError("invalid_review_context")); const id = parseResearchIdFor(raw.id, "rdec_"); const version = parseEntityVersion(raw.version); if (!id.ok || !version.ok || decisions.some((item) => item.id === id.value.id)) return reviewErr(reviewError("invalid_review_context")); decisions.push({ id: id.value.id, version: version.value, status: raw.status }); }
  const issues: ReviewIssueBinding[] = [];
  for (const raw of input.relevantIssues) { if (!record(raw) || !nonBlank(raw.status)) return reviewErr(reviewError("invalid_review_context")); const id = parseResearchIdFor(raw.id, "riss_"); const version = parseEntityVersion(raw.version); if (!id.ok || !version.ok || issues.some((item) => item.id === id.value.id)) return reviewErr(reviewError("invalid_review_context")); issues.push({ id: id.value.id, version: version.value, status: raw.status.trim() }); }
  const boundaries: ReviewEvidenceBoundaryBinding[] = [];
  for (const raw of input.evidenceBoundaries) { if (!record(raw) || !nonBlank(raw.statement)) return reviewErr(reviewError("invalid_review_context")); const id = parseResearchIdFor(raw.id, "rbrf_"); if (!id.ok || boundaries.some((item) => item.id === id.value.id)) return reviewErr(reviewError("invalid_review_context")); boundaries.push({ id: id.value.id, statement: raw.statement.trim() }); }
  const checkers: CheckerIdentity[] = [];
  for (const raw of input.checkerSet) { const parsed = parseCheckerIdentity(raw); if (!parsed.ok || checkers.some((item) => item.id === parsed.value.id && item.version === parsed.value.version)) return reviewErr(reviewError("invalid_review_context")); checkers.push(parsed.value); }
  if (checkers.length === 0) return reviewErr(reviewError("invalid_review_context"));
  const snapshotId = parseResearchIdFor(input.snapshot.id, "rsnp_"); const snapshotProject = parseResearchIdFor(input.snapshot.projectId, "rprj_"); const snapshotEpisode = parseResearchIdFor(input.snapshot.episodeId, "repi_");
  if (!snapshotId.ok || !snapshotProject.ok || !snapshotEpisode.ok || !hash(input.snapshot.hash)) return reviewErr(reviewError("invalid_review_context"));
  const normalized: ReviewContextInput = {
    project: { id: projectId.value.id, version: projectVersion.value },
    episode: { id: episodeId.value.id, version: episodeVersion.value, artifactId: artifactId.value.id, baselineRevisionId: baselineId.value.id, candidateRevisionId: candidateId.value.id },
    baselineRevision: baseline.value, candidateRevision: candidate.value,
    briefVersion: { id: briefId.value.id, versionNumber: Number(input.briefVersion.versionNumber) },
    activeDecisions: decisions, relevantIssues: issues, evidenceBoundaries: boundaries,
    snapshot: { id: snapshotId.value.id, projectId: snapshotProject.value.id, episodeId: snapshotEpisode.value.id, hash: input.snapshot.hash },
    checkerSet: checkers, environmentFingerprint: input.environmentFingerprint, buildFingerprint: input.buildFingerprint,
  };
  if (calculateReviewInputHash(normalized) !== input.inputHash) return reviewErr(reviewError("review_input_hash_mismatch"));
  return reviewOk(cloneReviewValue({ ...normalized, inputHash: input.inputHash }));
}
