import { parseResearchIdFor } from "@sestina/research";

import {
  parseFinding,
  type Finding,
  type FindingConfidence,
  type FindingProvenance,
  type FindingSeverity,
} from "../finding.js";
import {
  parseFindingEvidenceSpan,
  type FindingEvidenceSpan,
} from "../finding-evidence.js";
import { mergeFindings } from "../findings/merge-findings.js";
import type {
  CheckerIdentity,
} from "../review-context.js";
import {
  cloneReviewValue,
  reviewErr,
  reviewError,
  reviewOk,
  type ReviewResult,
} from "../review-result.js";

export const MINIMAL_CORRECTION_SCHEMA_VERSION = "1.0.0" as const;
export const MAX_MINIMAL_CORRECTIONS = 3;

export type SuggestionOwnership = FindingProvenance["authority"];

export interface PreservedCorrectionPart {
  readonly statement: string;
  readonly evidenceFindingIds: readonly string[];
}

export interface MinimalCorrectionContext {
  readonly projectId: string;
  readonly briefVersionId: string;
  readonly currentResearchTask: string;
  readonly targetArtifactIds: readonly string[];
  readonly targetRelativePaths: readonly string[];
  readonly protectedDecisionIds: readonly string[];
  readonly preservedParts: readonly PreservedCorrectionPart[];
  readonly maxCorrections?: number;
}

export interface MinimalCorrectionSources {
  readonly mergedFindingId: string;
  readonly rawFindingIds: readonly string[];
  readonly criterion: string;
  readonly rootCause: string;
  readonly severity: FindingSeverity;
  readonly checker: CheckerIdentity;
  readonly confidence: FindingConfidence;
  readonly baselineEvidence: readonly FindingEvidenceSpan[];
  readonly candidateEvidence: readonly FindingEvidenceSpan[];
  readonly decisionIds: readonly string[];
  readonly issueIds: readonly string[];
  readonly provenance: readonly FindingProvenance[];
  readonly rawFindings: readonly Finding[];
}

export interface MinimalCorrection {
  readonly id: string;
  readonly status: "proposed";
  readonly suggestionOwnership: SuggestionOwnership;
  readonly preserve: readonly string[];
  readonly stop: readonly string[];
  readonly minimumMissingRelationOrAction: string;
  readonly mustNotChange: {
    readonly briefVersionId: string;
    readonly currentResearchTask: string;
    readonly protectedDecisionIds: readonly string[];
  };
  readonly recoveryVerification: readonly string[];
  readonly sources: MinimalCorrectionSources;
}

export type MinimalCorrectionUnavailableReason =
  | "brief_version_mismatch"
  | "intervention_budget_exhausted"
  | "missing_source_finding"
  | "target_outside_locked_brief"
  | "unsafe_recovery_action";

export type MinimalCorrectionProjection =
  | {
    readonly schemaVersion: typeof MINIMAL_CORRECTION_SCHEMA_VERSION;
    readonly status: "ready";
    readonly projectId: string;
    readonly briefVersionId: string;
    readonly corrections: readonly MinimalCorrection[];
    readonly omittedForegroundFindingIds: readonly string[];
  }
  | {
    readonly schemaVersion: typeof MINIMAL_CORRECTION_SCHEMA_VERSION;
    readonly status: "not_needed";
    readonly projectId: string;
    readonly briefVersionId: string;
    readonly reason: "no_foreground_findings";
    readonly corrections: readonly [];
    readonly omittedForegroundFindingIds: readonly [];
  }
  | {
    readonly schemaVersion: typeof MINIMAL_CORRECTION_SCHEMA_VERSION;
    readonly status: "uncorrectable";
    readonly projectId: string;
    readonly briefVersionId: string;
    readonly reason: MinimalCorrectionUnavailableReason;
    readonly affectedFindingIds: readonly string[];
    readonly corrections: readonly [];
    readonly omittedForegroundFindingIds: readonly [];
  };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, maximum = 300): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum;
}

function stringList(
  value: unknown,
  maximumItems: number,
  maximumText = 300,
  allowEmpty = true,
): value is readonly string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.length <= maximumItems
    && value.every((item) => text(item, maximumText))
    && new Set(value).size === value.length;
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && /^mcor_[a-f0-9]{64}$/u.test(value);
}

function validCorrection(value: unknown): value is MinimalCorrection {
  if (
    !record(value)
    || !validIdentity(value.id)
    || value.status !== "proposed"
    || !["system_derived", "model_proposed"].includes(
      String(value.suggestionOwnership),
    )
    || !stringList(value.preserve, 5, 300, false)
    || !stringList(value.stop, 2, 240, false)
    || !text(value.minimumMissingRelationOrAction, 300)
    || !record(value.mustNotChange)
    || !text(value.mustNotChange.currentResearchTask, 300)
    || !stringList(value.mustNotChange.protectedDecisionIds, 64, 64)
    || !stringList(value.recoveryVerification, 3, 300, false)
    || !record(value.sources)
    || !text(value.sources.mergedFindingId, 64)
    || !stringList(value.sources.rawFindingIds, 64, 64, false)
    || !text(value.sources.criterion, 300)
    || !text(value.sources.rootCause, 120)
    || !["info", "warning", "error", "critical"].includes(
      String(value.sources.severity),
    )
    || !record(value.sources.checker)
    || !record(value.sources.confidence)
    || !Array.isArray(value.sources.baselineEvidence)
    || !Array.isArray(value.sources.candidateEvidence)
    || !stringList(value.sources.decisionIds, 64, 64)
    || !stringList(value.sources.issueIds, 64, 64)
    || !Array.isArray(value.sources.provenance)
    || !Array.isArray(value.sources.rawFindings)
    || value.sources.rawFindings.length !== value.sources.rawFindingIds.length
    || value.sources.provenance.length !== value.sources.rawFindingIds.length
  ) return false;

  const brief = parseResearchIdFor(
    value.mustNotChange.briefVersionId,
    "rbrf_",
  );
  const mergedFinding = parseResearchIdFor(
    value.sources.mergedFindingId,
    "rfnd_",
  );
  if (
    !brief.ok
    || !mergedFinding.ok
    || !value.sources.rawFindingIds.includes(mergedFinding.value.id)
    || !text(value.sources.checker.id, 120)
    || !text(value.sources.checker.version, 64)
    || !["deterministic", "semantic"].includes(
      String(value.sources.checker.kind),
    )
    || !["rule", "model", "hybrid"].includes(
      String(value.sources.confidence.source),
    )
    || typeof value.sources.confidence.value !== "number"
    || !Number.isFinite(value.sources.confidence.value)
    || value.sources.confidence.value < 0
    || value.sources.confidence.value > 1
    || value.sources.baselineEvidence.some(
      (span) => !parseFindingEvidenceSpan(span).ok,
    )
    || value.sources.candidateEvidence.some(
      (span) => !parseFindingEvidenceSpan(span).ok,
    )
  ) return false;

  const sourceFindingIds = value.sources.rawFindingIds;
  const sourceProvenance = value.sources.provenance;
  const rawFindings: Finding[] = [];
  for (const raw of value.sources.rawFindings) {
    const parsed = parseFinding(raw);
    if (!parsed.ok) return false;
    rawFindings.push(parsed.value);
  }
  if (
    rawFindings.some(
      (finding, index) => finding.id !== sourceFindingIds[index]
        || JSON.stringify(finding.provenance)
          !== JSON.stringify(sourceProvenance[index]),
    )
    || value.suggestionOwnership
      !== (rawFindings.some(
        (finding) => finding.provenance.authority === "model_proposed",
      ) ? "model_proposed" : "system_derived")
  ) return false;
  const merged = mergeFindings(rawFindings);
  if (merged.length !== 1) return false;
  const expected = merged[0];
  if (expected === undefined) return false;
  if (
    expected.finding.id !== value.sources.mergedFindingId
    || expected.criterion !== value.sources.criterion
    || expected.rootCause !== value.sources.rootCause
    || expected.finding.severity !== value.sources.severity
    || JSON.stringify(expected.finding.checker)
      !== JSON.stringify(value.sources.checker)
    || JSON.stringify(expected.finding.confidence)
      !== JSON.stringify(value.sources.confidence)
    || JSON.stringify(expected.finding.baselineEvidence)
      !== JSON.stringify(value.sources.baselineEvidence)
    || JSON.stringify(expected.finding.candidateEvidence)
      !== JSON.stringify(value.sources.candidateEvidence)
    || JSON.stringify(expected.finding.decisionIds)
      !== JSON.stringify(value.sources.decisionIds)
    || JSON.stringify(expected.finding.issueIds)
      !== JSON.stringify(value.sources.issueIds)
  ) return false;
  return true;
}

export function parseMinimalCorrectionProjection(
  input: unknown,
): ReviewResult<MinimalCorrectionProjection> {
  if (
    !record(input)
    || input.schemaVersion !== MINIMAL_CORRECTION_SCHEMA_VERSION
    || !["ready", "not_needed", "uncorrectable"].includes(
      String(input.status),
    )
    || !Array.isArray(input.corrections)
    || !stringList(input.omittedForegroundFindingIds, 64, 64)
  ) return reviewErr(reviewError("invalid_minimal_correction"));

  const project = parseResearchIdFor(input.projectId, "rprj_");
  const brief = parseResearchIdFor(input.briefVersionId, "rbrf_");
  if (!project.ok || !brief.ok) {
    return reviewErr(reviewError("invalid_minimal_correction"));
  }

  if (input.status === "ready") {
    if (
      input.corrections.length === 0
      || input.corrections.length > MAX_MINIMAL_CORRECTIONS
      || !input.corrections.every(validCorrection)
      || new Set(input.corrections.map((item) => item.id)).size
        !== input.corrections.length
    ) return reviewErr(reviewError("invalid_minimal_correction"));
    return reviewOk(cloneReviewValue(input as unknown as MinimalCorrectionProjection));
  }

  if (input.corrections.length > 0 || input.omittedForegroundFindingIds.length > 0) {
    return reviewErr(reviewError("invalid_minimal_correction"));
  }
  if (input.status === "not_needed") {
    if (input.reason !== "no_foreground_findings") {
      return reviewErr(reviewError("invalid_minimal_correction"));
    }
    return reviewOk(cloneReviewValue(input as unknown as MinimalCorrectionProjection));
  }

  if (
    ![
      "brief_version_mismatch",
      "intervention_budget_exhausted",
      "missing_source_finding",
      "target_outside_locked_brief",
      "unsafe_recovery_action",
    ].includes(String(input.reason))
    || !stringList(input.affectedFindingIds, 64, 64, false)
  ) return reviewErr(reviewError("invalid_minimal_correction"));
  return reviewOk(cloneReviewValue(input as unknown as MinimalCorrectionProjection));
}
