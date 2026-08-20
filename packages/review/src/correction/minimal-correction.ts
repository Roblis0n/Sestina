import {
  parseResearchIdFor,
  stableResearchHash,
} from "@sestina/research";

import { parseFinding, type Finding } from "../finding.js";
import type { FindingProjection } from "../findings/intervention-budget.js";
import type { MergedFinding } from "../findings/merge-findings.js";
import {
  reviewErr,
  reviewError,
  type ReviewResult,
} from "../review-result.js";
import {
  MAX_MINIMAL_CORRECTIONS,
  MINIMAL_CORRECTION_SCHEMA_VERSION,
  parseMinimalCorrectionProjection,
  type MinimalCorrection,
  type MinimalCorrectionContext,
  type MinimalCorrectionProjection,
  type MinimalCorrectionUnavailableReason,
} from "./correction-shape.js";

interface ParsedContext extends MinimalCorrectionContext {
  readonly maxCorrections: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, maximum = 300): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function parseIdList(
  raw: unknown,
  prefix: "rart_" | "rdec_",
): readonly string[] | undefined {
  if (!Array.isArray(raw) || raw.length > 64) return undefined;
  const result: string[] = [];
  for (const item of raw) {
    const parsed = parseResearchIdFor(item, prefix);
    if (!parsed.ok || result.includes(parsed.value.id)) return undefined;
    result.push(parsed.value.id);
  }
  return Object.freeze(result.sort());
}

function parsePathList(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw) || raw.length > 64) return undefined;
  const result: string[] = [];
  for (const item of raw) {
    if (
      !text(item, 260)
      || /^(?:[a-z]:|\\|\/)|(?:^|\/)\.\.(?:\/|$)/iu.test(item)
      || result.includes(item)
    ) return undefined;
    result.push(item);
  }
  return Object.freeze(result.sort());
}

function parseContext(raw: unknown): ParsedContext | undefined {
  if (
    !record(raw)
    || !text(raw.currentResearchTask)
    || !Array.isArray(raw.preservedParts)
    || raw.preservedParts.length > 20
  ) return undefined;
  const project = parseResearchIdFor(raw.projectId, "rprj_");
  const brief = parseResearchIdFor(raw.briefVersionId, "rbrf_");
  const artifacts = parseIdList(raw.targetArtifactIds, "rart_");
  const decisions = parseIdList(raw.protectedDecisionIds, "rdec_");
  const paths = parsePathList(raw.targetRelativePaths);
  const maxCorrections = raw.maxCorrections === undefined
    ? MAX_MINIMAL_CORRECTIONS
    : raw.maxCorrections;
  if (
    !project.ok
    || !brief.ok
    || artifacts === undefined
    || decisions === undefined
    || paths === undefined
    || !Number.isSafeInteger(maxCorrections)
    || Number(maxCorrections) < 0
    || Number(maxCorrections) > MAX_MINIMAL_CORRECTIONS
  ) return undefined;

  const preservedParts: {
    statement: string;
    evidenceFindingIds: readonly string[];
  }[] = [];
  for (const item of raw.preservedParts) {
    if (
      !record(item)
      || !text(item.statement)
      || !Array.isArray(item.evidenceFindingIds)
      || item.evidenceFindingIds.length > 64
    ) return undefined;
    const evidenceFindingIds: string[] = [];
    for (const id of item.evidenceFindingIds) {
      const parsed = parseResearchIdFor(id, "rfnd_");
      if (!parsed.ok || evidenceFindingIds.includes(parsed.value.id)) {
        return undefined;
      }
      evidenceFindingIds.push(parsed.value.id);
    }
    preservedParts.push({
      statement: item.statement.trim(),
      evidenceFindingIds: Object.freeze(evidenceFindingIds.sort()),
    });
  }
  return Object.freeze({
    projectId: project.value.id,
    briefVersionId: brief.value.id,
    currentResearchTask: raw.currentResearchTask.trim(),
    targetArtifactIds: artifacts,
    targetRelativePaths: paths,
    protectedDecisionIds: decisions,
    preservedParts: Object.freeze(preservedParts),
    maxCorrections: Number(maxCorrections),
  });
}

function parseProjection(raw: unknown): FindingProjection | undefined {
  if (
    !record(raw)
    || !Array.isArray(raw.raw)
    || !Array.isArray(raw.merged)
    || !Array.isArray(raw.foreground)
    || !Array.isArray(raw.suppressed)
    || !Array.isArray(raw.auditTrail)
    || !record(raw.omissions)
    || !record(raw.preserved)
    || !record(raw.metrics)
  ) return undefined;
  const rawFindingIds = new Set<string>();
  for (const item of raw.raw) {
    if (!record(item)) return undefined;
    const parsed = parseFinding(item.finding);
    if (!parsed.ok || item.findingId !== parsed.value.id) return undefined;
    rawFindingIds.add(parsed.value.id);
  }
  for (const item of raw.foreground) {
    if (
      !record(item)
      || !record(item.finding)
      || !Array.isArray(item.rawFindingIds)
      || item.rawFindingIds.some(
        (id) => typeof id !== "string" || !rawFindingIds.has(id),
      )
    ) return undefined;
    const parsed = parseFinding(item.finding);
    if (!parsed.ok) return undefined;
  }
  return raw as unknown as FindingProjection;
}

function targetInsideBrief(
  finding: Finding,
  context: ParsedContext,
): boolean {
  if (finding.briefVersionId !== context.briefVersionId) return false;
  if (["project", "brief", "decision", "issue"].includes(finding.target.kind)) {
    return true;
  }
  if (finding.target.kind === "path") {
    return finding.target.relativePath !== undefined
      && context.targetRelativePaths.includes(finding.target.relativePath);
  }
  if (["artifact", "block"].includes(finding.target.kind)) {
    return finding.target.artifactId !== undefined
      && context.targetArtifactIds.includes(finding.target.artifactId);
  }
  return false;
}

const UNSAFE_RECOVERY = /(?:rewrite|replace)\s+(?:the\s+)?(?:entire|whole|full)|comprehensive(?:ly)?\s+(?:audit|review|improve)|improve\s+(?:the\s+)?(?:overall\s+)?quality|full\s+rewrite|全文重写|全面(?:审计|评审|提升)|提升(?:整体)?质量/iu;

function normalizedAction(finding: Finding): string | undefined {
  const action = finding.minimumRecovery.replace(/\s+/gu, " ").trim();
  if (!text(action) || UNSAFE_RECOVERY.test(action)) return undefined;
  return action;
}

function stopFor(rootCause: string): string {
  if (rootCause === "target_substitution_or_authority") {
    return "Stop replacing the locked research task or expanding auxiliary checks into another audit.";
  }
  if (rootCause === "scope_data_or_revision") {
    return "Stop changing material outside the locked Brief target and revision scope.";
  }
  if (rootCause === "expected_argument_delta") {
    return "Stop substituting rewording or generic expansion for the registered argument delta.";
  }
  if (rootCause.includes("evidence")) {
    return "Stop presenting the affected claim beyond the cited evidence and mechanism relation.";
  }
  return "Stop expanding this Finding beyond its cited target and minimum recovery.";
}

function verificationFor(
  merged: MergedFinding,
  context: ParsedContext,
): string {
  if (merged.rootCause === "target_substitution_or_authority") {
    return "The next candidate stays on the locked research task, adds no new goal, and the triggering Finding no longer appears.";
  }
  if (merged.rootCause === "expected_argument_delta") {
    return "The next candidate contains the one registered relation or contrast while the Brief and protected decisions remain unchanged.";
  }
  if (merged.rootCause.includes("evidence")) {
    return "The next candidate makes the cited claim-evidence-mechanism relation explicit without adding a claim or research goal.";
  }
  return `The next candidate contains only the minimum action, clears the triggering Finding, and remains bound to ${context.briefVersionId}.`;
}

function unavailable(
  context: ParsedContext,
  reason: MinimalCorrectionUnavailableReason,
  findingIds: readonly string[],
): ReviewResult<MinimalCorrectionProjection> {
  return parseMinimalCorrectionProjection({
    schemaVersion: MINIMAL_CORRECTION_SCHEMA_VERSION,
    status: "uncorrectable",
    projectId: context.projectId,
    briefVersionId: context.briefVersionId,
    reason,
    affectedFindingIds: uniqueSorted(findingIds),
    corrections: [],
    omittedForegroundFindingIds: [],
  });
}

function correctionFor(
  merged: MergedFinding,
  rawById: ReadonlyMap<string, Finding>,
  context: ParsedContext,
  action: string,
): MinimalCorrection | undefined {
  const rawFindings: Finding[] = [];
  for (const id of merged.rawFindingIds) {
    const finding = rawById.get(id);
    if (finding === undefined) return undefined;
    rawFindings.push(finding);
  }
  const preserve = uniqueSorted(
    context.preservedParts
      .filter((part) => part.evidenceFindingIds.some(
        (id) => merged.rawFindingIds.includes(id),
      ))
      .map((part) => part.statement),
  );
  const effectivePreserve = preserve.length > 0
    ? preserve
    : Object.freeze([
      "Keep the locked research task and its accepted content unchanged.",
    ]);
  const ownership = rawFindings.some(
    (finding) => finding.provenance.authority === "model_proposed",
  ) ? "model_proposed" : "system_derived";
  const identityPayload = {
    projectId: context.projectId,
    briefVersionId: context.briefVersionId,
    rawFindingIds: merged.rawFindingIds,
    action,
    task: context.currentResearchTask,
    protectedDecisionIds: context.protectedDecisionIds,
  };
  const hash = stableResearchHash(identityPayload);
  if (!hash.ok) return undefined;
  return {
    id: `mcor_${hash.value}`,
    status: "proposed",
    suggestionOwnership: ownership,
    preserve: effectivePreserve,
    stop: Object.freeze([stopFor(merged.rootCause)]),
    minimumMissingRelationOrAction: action,
    mustNotChange: Object.freeze({
      briefVersionId: context.briefVersionId,
      currentResearchTask: context.currentResearchTask,
      protectedDecisionIds: context.protectedDecisionIds,
    }),
    recoveryVerification: Object.freeze([
      verificationFor(merged, context),
    ]),
    sources: Object.freeze({
      mergedFindingId: merged.finding.id,
      rawFindingIds: Object.freeze([...merged.rawFindingIds]),
      criterion: merged.criterion,
      rootCause: merged.rootCause,
      severity: merged.finding.severity,
      checker: merged.finding.checker,
      confidence: merged.finding.confidence,
      baselineEvidence: merged.finding.baselineEvidence,
      candidateEvidence: merged.finding.candidateEvidence,
      decisionIds: merged.finding.decisionIds,
      issueIds: merged.finding.issueIds,
      provenance: Object.freeze(rawFindings.map(
        (finding) => finding.provenance,
      )),
      rawFindings: Object.freeze(rawFindings),
    }),
  };
}

export function buildMinimalCorrections(
  rawProjection: unknown,
  rawContext: unknown,
): ReviewResult<MinimalCorrectionProjection> {
  const projection = parseProjection(rawProjection);
  const context = parseContext(rawContext);
  if (projection === undefined || context === undefined) {
    return reviewErr(reviewError("invalid_minimal_correction"));
  }
  if (projection.foreground.length === 0) {
    return parseMinimalCorrectionProjection({
      schemaVersion: MINIMAL_CORRECTION_SCHEMA_VERSION,
      status: "not_needed",
      projectId: context.projectId,
      briefVersionId: context.briefVersionId,
      reason: "no_foreground_findings",
      corrections: [],
      omittedForegroundFindingIds: [],
    });
  }
  if (context.maxCorrections === 0) {
    return unavailable(
      context,
      "intervention_budget_exhausted",
      projection.foreground.map((item) => item.finding.id),
    );
  }
  const mismatched = projection.foreground.filter(
    (item) => item.finding.briefVersionId !== context.briefVersionId,
  );
  if (mismatched.length > 0) {
    return unavailable(
      context,
      "brief_version_mismatch",
      mismatched.map((item) => item.finding.id),
    );
  }
  const outside = projection.foreground.filter(
    (item) => !targetInsideBrief(item.finding, context),
  );
  if (outside.length > 0) {
    return unavailable(
      context,
      "target_outside_locked_brief",
      outside.map((item) => item.finding.id),
    );
  }
  const unsafe = projection.foreground.filter(
    (item) => normalizedAction(item.finding) === undefined,
  );
  if (unsafe.length > 0) {
    return unavailable(
      context,
      "unsafe_recovery_action",
      unsafe.map((item) => item.finding.id),
    );
  }

  const rawById = new Map(
    projection.raw.map((item) => [item.findingId, item.finding] as const),
  );
  const corrections: MinimalCorrection[] = [];
  const seenActions = new Set<string>();
  const omitted: string[] = [];
  for (const merged of projection.foreground) {
    const action = normalizedAction(merged.finding);
    if (action === undefined) continue;
    const actionKey = action.toLocaleLowerCase("en-US");
    if (seenActions.has(actionKey) || corrections.length >= context.maxCorrections) {
      omitted.push(merged.finding.id);
      continue;
    }
    const correction = correctionFor(merged, rawById, context, action);
    if (correction === undefined) {
      return unavailable(context, "missing_source_finding", [merged.finding.id]);
    }
    seenActions.add(actionKey);
    corrections.push(correction);
  }
  return parseMinimalCorrectionProjection({
    schemaVersion: MINIMAL_CORRECTION_SCHEMA_VERSION,
    status: "ready",
    projectId: context.projectId,
    briefVersionId: context.briefVersionId,
    corrections,
    omittedForegroundFindingIds: uniqueSorted(omitted),
  });
}
