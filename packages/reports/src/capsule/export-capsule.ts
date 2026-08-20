import { canonicalStringify, parseResearchIdFor, stableResearchHash } from "@sestina/research";
import { parseProjectRelativePath, type CheckerIdentity, type FindingProjection } from "@sestina/review";
import { DEFAULT_CAPSULE_MAX_BYTES, DEFAULT_CAPSULE_MAX_ITEMS_PER_SECTION, DEFAULT_CAPSULE_TEXT_MAX_BYTES, truncateUtf8, utf8ByteLength } from "../limits.js";
import { redactAbsolutePaths } from "../redaction/redact.js";
import { reportErr, reportOk, type ReportResult } from "../result.js";
import { CAPSULE_RESPONSE_SCHEMA } from "./response-schema.js";

export interface CapsuleRevisionInput { readonly artifactId: string; readonly revisionId: string; readonly relativePath: string; readonly summary: string; readonly content?: string; readonly privacy: "public" | "private_a" | "private_b"; readonly contentPermission: "summary_only" | "full_text"; }
export interface CapsuleExportInput {
  readonly projectId: string; readonly brief: { readonly id: string; readonly summary: string; readonly expectedDeltas: readonly string[] };
  readonly activeDecisions: readonly { readonly id: string; readonly statement: string; readonly status: string }[];
  readonly relevantIssues: readonly { readonly id: string; readonly summary: string; readonly status: string }[];
  readonly baseline: CapsuleRevisionInput; readonly candidate: CapsuleRevisionInput;
  readonly evidenceBoundaries: readonly string[]; readonly expectedDeltas: readonly string[];
  readonly snapshotId: string; readonly snapshotHash: string; readonly reviewInputHash: string;
  readonly invalidationConditions: readonly string[]; readonly buildFingerprint: string; readonly checkerVersions: readonly CheckerIdentity[];
  readonly stateBindingHash: string;
  readonly findingProjection?: FindingProjection;
}
export interface CapsuleExportOptions { readonly maxBytes?: number; readonly maxItemsPerSection?: number; readonly includePermittedFullText?: boolean; }
export interface ReviewCapsule { readonly [key: string]: unknown; readonly schemaVersion: "1.0.0"; readonly projectId: string; readonly reviewInputHash: string; readonly snapshot: { readonly id: string; readonly hash: string }; readonly hashMeaning: "content_integrity_only_not_signature_or_proof"; readonly capsuleHash: string; }

function safeText(value: string, maxBytes = DEFAULT_CAPSULE_TEXT_MAX_BYTES): string { return truncateUtf8(redactAbsolutePaths(value), maxBytes).text; }
function validHash(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }
function serialize(value: unknown): string { const result = canonicalStringify(value); if (!result.ok) throw new Error("invalid capsule"); return result.value; }

export function exportCapsule(input: CapsuleExportInput, options: CapsuleExportOptions = {}): ReportResult<{ readonly capsule: ReviewCapsule; readonly json: string }> {
  const project = parseResearchIdFor(input.projectId, "rprj_"); const brief = parseResearchIdFor(input.brief.id, "rbrf_"); const snapshot = parseResearchIdFor(input.snapshotId, "rsnp_");
  if (!project.ok || !brief.ok || !snapshot.ok || !validHash(input.snapshotHash) || !validHash(input.reviewInputHash) || !validHash(input.buildFingerprint) || !validHash(input.stateBindingHash)) return reportErr("invalid_capsule");
  const maxBytes = options.maxBytes ?? DEFAULT_CAPSULE_MAX_BYTES; const maxItems = options.maxItemsPerSection ?? DEFAULT_CAPSULE_MAX_ITEMS_PER_SECTION;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 512 || !Number.isSafeInteger(maxItems) || maxItems < 0) return reportErr("invalid_capsule");
  let omittedDecisions = Math.max(0, input.activeDecisions.length - maxItems); let omittedIssues = Math.max(0, input.relevantIssues.length - maxItems);
  let omittedBoundaries = Math.max(0, input.evidenceBoundaries.length - maxItems); let omittedDeltas = Math.max(0, input.expectedDeltas.length - maxItems);
  let omittedBriefDeltas = Math.max(0, input.brief.expectedDeltas.length - maxItems); let omittedInvalidationConditions = Math.max(0, input.invalidationConditions.length - maxItems);
  let omittedCheckerVersions = Math.max(0, input.checkerVersions.length - maxItems); let omittedBaselineContent = 0; let omittedCandidateContent = 0;
  let omittedFindingForeground = Math.max(0, (input.findingProjection?.foreground.length ?? 0) - maxItems);
  let omittedFindingSuppressed = Math.max(0, (input.findingProjection?.suppressed.length ?? 0) - maxItems);
  let decisions = [...input.activeDecisions].sort((a, b) => a.id.localeCompare(b.id)).slice(0, maxItems).map((item) => ({ ...item, statement: safeText(item.statement), status: safeText(item.status) }));
  let issues = [...input.relevantIssues].sort((a, b) => a.id.localeCompare(b.id)).slice(0, maxItems).map((item) => ({ ...item, summary: safeText(item.summary), status: safeText(item.status) }));
  let boundaries = [...input.evidenceBoundaries].sort().slice(0, maxItems).map((item) => safeText(item)); let deltas = [...input.expectedDeltas].sort().slice(0, maxItems).map((item) => safeText(item));
  let briefDeltas = [...input.brief.expectedDeltas].sort().slice(0, maxItems).map((item) => safeText(item));
  let invalidationConditions = [...input.invalidationConditions].sort().slice(0, maxItems).map((item) => safeText(item));
  let checkerVersions = [...input.checkerVersions].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version)).slice(0, maxItems);
  let findingForeground = (input.findingProjection?.foreground ?? []).slice(0, maxItems).map((item) => ({
    id: item.finding.id, rawFindingIds: item.rawFindingIds.slice(0, maxItems), rawFindingIdsOmitted: Math.max(0, item.rawFindingIds.length - maxItems), rootCause: item.rootCause, priority: item.priority,
    severity: item.finding.severity, target: item.finding.target, rationale: safeText(item.finding.rationale), minimumRecovery: safeText(item.finding.minimumRecovery),
  }));
  let findingSuppressed = (input.findingProjection?.suppressed ?? []).slice(0, maxItems).map((item) => ({
    id: item.findingId, kind: item.finding.kind, severity: item.finding.severity, rationale: safeText(item.finding.rationale), reason: item.reason,
  }));
  const findingMetrics = input.findingProjection === undefined ? undefined : {
    ...input.findingProjection.metrics,
    returnToMainTaskActions: input.findingProjection.metrics.returnToMainTaskActions.slice(0, maxItems).map((item) => safeText(item)),
    returnToMainTaskActionsOmitted: Math.max(0, input.findingProjection.metrics.returnToMainTaskActions.length - maxItems),
  };
  const revision = (value: CapsuleRevisionInput) => {
    const artifact = parseResearchIdFor(value.artifactId, "rart_"); const id = parseResearchIdFor(value.revisionId, "rrev_"); const path = parseProjectRelativePath(value.relativePath);
    if (!artifact.ok || !id.ok) throw new Error("invalid capsule");
    const include = options.includePermittedFullText === true && value.contentPermission === "full_text";
    return { artifactId: artifact.value.id, revisionId: id.value.id, relativePath: path.ok ? path.value : "[redacted-path]", summary: safeText(value.summary), privacy: value.privacy, projection: include && value.content ? "permitted_full_text" : "summary_only", ...(include && value.content ? { content: safeText(value.content) } : {}) };
  };
  let baseline: ReturnType<typeof revision>;
  let candidate: ReturnType<typeof revision>;
  try { baseline = revision(input.baseline); candidate = revision(input.candidate); } catch { return reportErr("invalid_capsule"); }
  const make = () => ({
    schemaVersion: "1.0.0" as const, projectId: project.value.id,
    brief: { id: brief.value.id, summary: safeText(input.brief.summary), expectedDeltas: briefDeltas },
    activeDecisions: decisions, relevantIssues: issues, baseline, candidate, evidenceBoundaries: boundaries, expectedDeltas: deltas,
    responseSchema: CAPSULE_RESPONSE_SCHEMA,
    snapshot: { id: snapshot.value.id, hash: input.snapshotHash }, reviewInputHash: input.reviewInputHash,
    stateBindingHash: input.stateBindingHash,
    invalidationConditions, buildFingerprint: input.buildFingerprint, checkerVersions,
    ...(input.findingProjection === undefined ? {} : { findings: {
      foreground: findingForeground,
      suppressed: findingSuppressed,
      omissions: { ...input.findingProjection.omissions, capsuleForegroundItems: omittedFindingForeground, capsuleSuppressedItems: omittedFindingSuppressed },
      metrics: findingMetrics,
    } }),
    truncationPolicy: { withinSection: "ascending_id_or_text", overflowDropOrder: ["issues", "decisions", "evidenceBoundaries", "expectedDeltas", "briefExpectedDeltas", "invalidationConditions", "checkerVersions", "suppressedFindings", "foregroundFindings"] },
    omissions: { decisions: omittedDecisions, issues: omittedIssues, evidenceBoundaries: omittedBoundaries, expectedDeltas: omittedDeltas, briefExpectedDeltas: omittedBriefDeltas, invalidationConditions: omittedInvalidationConditions, checkerVersions: omittedCheckerVersions, findingForeground: omittedFindingForeground, findingSuppressed: omittedFindingSuppressed, baselineContent: omittedBaselineContent, candidateContent: omittedCandidateContent },
    hashMeaning: "content_integrity_only_not_signature_or_proof" as const,
  });
  let body = make();
  const withHash = () => { const hash = stableResearchHash(body); if (!hash.ok) throw new Error("invalid capsule"); return { ...body, capsuleHash: hash.value }; };
  let capsule: ReturnType<typeof withHash>; let json: string;
  try { capsule = withHash(); json = serialize(capsule); } catch { return reportErr("invalid_capsule"); }
  if (utf8ByteLength(json) > maxBytes) {
    if ("content" in baseline) omittedBaselineContent = 1;
    if ("content" in candidate) omittedCandidateContent = 1;
    baseline = { ...baseline, summary: safeText(baseline.summary, 128), projection: "summary_only" }; delete (baseline as { content?: string }).content;
    candidate = { ...candidate, summary: safeText(candidate.summary, 128), projection: "summary_only" }; delete (candidate as { content?: string }).content;
    body = make(); capsule = withHash(); json = serialize(capsule);
    while (utf8ByteLength(json) > maxBytes && (decisions.length + issues.length + boundaries.length + deltas.length + briefDeltas.length + invalidationConditions.length + checkerVersions.length + findingForeground.length + findingSuppressed.length > 0)) {
      if (issues.length > 0) { issues = issues.slice(0, -1); omittedIssues += 1; }
      else if (decisions.length > 0) { decisions = decisions.slice(0, -1); omittedDecisions += 1; }
      else if (boundaries.length > 0) { boundaries = boundaries.slice(0, -1); omittedBoundaries += 1; }
      else if (deltas.length > 0) { deltas = deltas.slice(0, -1); omittedDeltas += 1; }
      else if (briefDeltas.length > 0) { briefDeltas = briefDeltas.slice(0, -1); omittedBriefDeltas += 1; }
      else if (invalidationConditions.length > 0) { invalidationConditions = invalidationConditions.slice(0, -1); omittedInvalidationConditions += 1; }
      else if (checkerVersions.length > 0) { checkerVersions = checkerVersions.slice(0, -1); omittedCheckerVersions += 1; }
      else if (findingSuppressed.length > 0) { findingSuppressed = findingSuppressed.slice(0, -1); omittedFindingSuppressed += 1; }
      else { findingForeground = findingForeground.slice(0, -1); omittedFindingForeground += 1; }
      body = make(); capsule = withHash(); json = serialize(capsule);
    }
  }
  return utf8ByteLength(json) <= maxBytes ? reportOk({ capsule, json }) : reportErr("capsule_too_small");
}
