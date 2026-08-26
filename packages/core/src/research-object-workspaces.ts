import { createHash } from "node:crypto";
import {
  type ArgumentEvidence,
  type BriefChangeSet,
  type BriefChangeStatus,
  type CorrectionAppeal,
  type DecisionScope,
  type DecisionStatus,
  type EpisodeStatus,
  type IssueStatus,
  type ResearchBrief,
  type ResearchBriefVersion,
  type ResearchDecision,
  type ResearchIssue,
  type ResearchPage,
  type ResearchPageRequest,
  type ResearchResult,
  type ResearchRoomReceipt,
  type ResearchSource,
  type RevisionEpisode,
} from "@sestina/research";
import type { ResearchStore } from "@sestina/research-store";
import { coreErr, coreOk, fromDomain, type CoreResult } from "./errors.js";

export const RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION = "1.0.0" as const;
const STORE_PAGE_LIMIT = 200;
const DEFAULT_HISTORY_LIMIT = 50;
const ATTENTION_LIMIT = 200;
const RESEARCH_ID_BODY = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const APPEALABLE_FINDING_KINDS = new Set(["focus_substitution", "repeated_audit", "audit_hijacking", "semantic_scope_violation", "decision_integrity", "argument_leap", "evidence_boundary", "shallow_abstraction"]);

function validResearchId(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && RESEARCH_ID_BODY.test(value.slice(prefix.length));
}

function fromStored<T>(result: ResearchResult<T>): CoreResult<T> {
  if (result.ok) return coreOk(result.value);
  if (result.error.code === "invalid_pagination") return coreErr("stale_state");
  if (result.error.code.startsWith("invalid_")) return coreErr("infrastructure_failure");
  return fromDomain(result);
}

export type ResearchObjectKind = "decision" | "issue" | "evidence" | "episode" | "receipt" | "appeal";
export type WorkspaceProviderStatus = "configured" | "ledger_only";

export interface WorkspaceListRequest {
  readonly limit: number;
  readonly cursor?: string;
  readonly status?: string;
  readonly query?: string;
  readonly source?: string;
  readonly scope?: string;
  readonly active?: boolean;
  readonly referencedByCurrentBrief?: boolean;
  readonly issueKind?: string;
  readonly relevance?: "current_brief";
  readonly unresolved?: boolean;
  readonly disposition?: string;
  readonly providerStatus?: string;
}

export interface WorkspacePage<T> {
  readonly schemaVersion: typeof RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly datasetVersion: string;
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface ProvenanceProjection {
  readonly authority: ResearchSource["authority"];
  readonly actorKind: ResearchSource["actor"]["kind"];
  readonly recordedAt: string;
}

export interface DecisionSummaryProjection {
  readonly kind: "decision";
  readonly id: string;
  readonly statement: string;
  readonly status: DecisionStatus;
  readonly scope: DecisionScope;
  readonly rationale: string;
  readonly effectiveBriefVersionId: string;
  readonly reopenConditions: readonly string[];
  readonly active: boolean;
  readonly referencedByCurrentBrief: boolean;
  readonly supersedesDecisionId?: string;
  readonly supersededByDecisionId?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: ProvenanceProjection;
}

export interface DecisionDetailProjection extends DecisionSummaryProjection {
  readonly availableActions: readonly ("accept" | "reject" | "freeze" | "supersede")[];
  readonly timeline: readonly {
    readonly from: DecisionStatus | null;
    readonly to: DecisionStatus;
    readonly reason: string;
    readonly at: string;
    readonly provenance: ProvenanceProjection;
  }[];
  readonly lineage: readonly {
    readonly id: string;
    readonly statement: string;
    readonly status: DecisionStatus;
    readonly version: number;
    readonly relation: "ancestor" | "current" | "replacement";
  }[];
  readonly lineageTruncated: boolean;
  readonly relatedBriefVersionIds: readonly string[];
  readonly relatedIssueIds: readonly string[];
  readonly relatedEpisodeIds: readonly string[];
  readonly relatedReceiptIds: readonly string[];
  readonly relationsTruncated: boolean;
}

export interface IssueSummaryProjection {
  readonly kind: "issue";
  readonly id: string;
  readonly issueKind: ResearchIssue["kind"];
  readonly summary: string;
  readonly status: IssueStatus;
  readonly violatedCriterion: string;
  readonly fingerprint: string;
  readonly recurrenceCount: number;
  readonly requiresUserAction: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: ProvenanceProjection;
}

export interface IssueDetailProjection extends IssueSummaryProjection {
  readonly availableActions: readonly ("resolve" | "waive" | "dispute" | "reopen")[];
  readonly target: ResearchIssue["target"];
  readonly rationaleConcepts: readonly string[];
  readonly sourceArtifactId: string;
  readonly sourceRevisionId: string;
  readonly sourceRevisionContentHash: string;
  readonly lineageRootRevisionId: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly resolution?: ResearchIssue["resolution"];
  readonly reopenHistory: ResearchIssue["reopenHistory"];
  readonly timeline: readonly {
    readonly from: IssueStatus | null;
    readonly to: IssueStatus;
    readonly reason: string;
    readonly at: string;
    readonly provenance: ProvenanceProjection;
  }[];
  readonly relatedBriefVersionIds: readonly string[];
  readonly relatedDecisionIds: readonly string[];
  readonly relatedEvidenceIds: readonly string[];
  readonly relatedEpisodeIds: readonly string[];
  readonly relatedReceiptIds: readonly string[];
  readonly relationsTruncated: boolean;
}

export interface EvidenceSummaryProjection {
  readonly kind: "evidence";
  readonly id: string;
  readonly evidenceKind: ArgumentEvidence["kind"];
  readonly summary: string;
  readonly state: ArgumentEvidence["state"];
  readonly inferenceCapacity: ArgumentEvidence["inferenceCapacity"];
  readonly artifactId?: string;
  readonly revisionId?: string;
  readonly version: number;
  readonly provenance: ProvenanceProjection;
}

export interface EvidenceDetailProjection extends EvidenceSummaryProjection {
  readonly contentVersionHash?: string;
  readonly safeLocator: { readonly artifactId?: string; readonly revisionId?: string };
  readonly capturedAt: string;
  readonly sensitivity: "not_recorded";
  readonly confidence: "not_recorded";
  readonly uncertainty: string;
  readonly userVerificationState: "user_recorded" | "not_user_verified";
  readonly claimLinks: readonly {
    readonly claimId: string;
    readonly role: string;
    readonly status: string;
  }[];
  readonly mechanismLinks: readonly {
    readonly mechanismLinkId: string;
    readonly stepIndex: number;
    readonly status: string;
  }[];
  readonly relatedBriefVersionIds: readonly string[];
  readonly relatedDecisionIds: readonly string[];
  readonly relatedIssueIds: readonly string[];
  readonly relatedEpisodeIds: readonly string[];
  readonly relationsTruncated: boolean;
}

export interface EpisodeSummaryProjection {
  readonly kind: "episode";
  readonly id: string;
  readonly artifactId: string;
  readonly status: EpisodeStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: ProvenanceProjection;
}

export interface EpisodeDetailProjection extends EpisodeSummaryProjection {
  readonly lockedStart: RevisionEpisode["lockedStart"];
  readonly lockedStartHash: string;
  readonly candidateRevisionId?: string;
  readonly reviewRunIds: readonly string[];
  readonly findingIds: readonly string[];
  readonly outcome?: RevisionEpisode["outcome"];
  readonly waivers: RevisionEpisode["waivers"];
  readonly timeline: RevisionEpisode["transitions"];
  readonly lockedBrief?: { readonly versionId: string; readonly stage: string; readonly task: string };
  readonly argumentDeltas: readonly { readonly receiptId: string; readonly kind: string; readonly summary: string }[];
  readonly relatedDecisionIds: readonly string[];
  readonly relatedIssueIds: readonly string[];
  readonly relatedReceiptIds: readonly string[];
  readonly relationsTruncated: boolean;
}

export interface ReceiptSummaryProjection {
  readonly kind: "receipt";
  readonly id: string;
  readonly reviewId: string;
  readonly sourceEpisodeId?: string;
  readonly status: ResearchRoomReceipt["status"];
  readonly providerStatus: ResearchRoomReceipt["providerStatus"];
  readonly evidenceClass: ResearchRoomReceipt["evidenceClass"];
  readonly disposition: ResearchRoomReceipt["disposition"];
  readonly rollback: ResearchRoomReceipt["rollback"];
  readonly version: number;
  readonly receiptHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReceiptDetailProjection extends ReceiptSummaryProjection {
  readonly countsAsExternalEvidence: false;
  readonly ledgerOnlyReason?: ResearchRoomReceipt["ledgerOnlyReason"];
  readonly suggestionHash: string;
  readonly argumentDelta: ResearchRoomReceipt["analysis"]["argumentDelta"];
  readonly findings: ResearchRoomReceipt["analysis"]["findings"];
  readonly alternativeExplanations: readonly string[];
  readonly unknowns: readonly string[];
  readonly unproven: readonly string[];
  readonly minimalCorrection: string;
  readonly contextFields: readonly {
    readonly category: string;
    readonly source: string;
    readonly sensitivity: string;
    readonly truncated: boolean;
  }[];
  readonly network: {
    readonly required: boolean;
    readonly used: boolean;
    readonly sendStatus: string;
  };
  readonly authority: ResearchRoomReceipt["authority"];
  readonly beforeStateHash: string;
  readonly afterStateHash: string;
  readonly relatedBriefVersionIds: readonly string[];
  readonly relatedDecisionIds: readonly string[];
  readonly relatedIssueIds: readonly string[];
  readonly correctionAppeals: readonly {
    readonly appealId: string;
    readonly findingId: string;
    readonly status: CorrectionAppeal["status"];
    readonly updatedAt: string;
    readonly href: string;
  }[];
  readonly appealableFindings: readonly {
    readonly findingId: string;
    readonly kind: string;
    readonly severity: "info" | "warning" | "error";
    readonly appealId?: string;
    readonly action: "create_appeal" | "open_appeal" | "unavailable";
    readonly href?: string;
    readonly unavailableReason?: "semantic_trace_unavailable" | "criterion_binding_unavailable";
  }[];
  readonly trace: readonly {
    readonly step: "suggestion" | "context_manifest" | "provider_or_ledger" | "assessment" | "finding_and_delta" | "user_disposition" | "state_change" | "receipt" | "correction_appeal" | "rollback";
    readonly summary: string;
  }[];
}

export interface AppealSummaryProjection {
  readonly kind: "appeal";
  readonly id: string;
  readonly reviewId: string;
  readonly sourceReceiptId: string;
  readonly findingId: string;
  readonly criterionId: string;
  readonly status: CorrectionAppeal["status"];
  readonly disagreement: string;
  readonly version: number;
  readonly attemptCount: number;
  readonly resolutionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AppealDetailProjection extends AppealSummaryProjection {
  readonly source: CorrectionAppeal["source"];
  readonly lineage: CorrectionAppeal["lineage"];
  readonly statements: CorrectionAppeal["statements"];
  readonly attempts: CorrectionAppeal["attempts"];
  readonly resolutions: CorrectionAppeal["resolutions"];
  readonly timeline: CorrectionAppeal["transitions"];
  readonly latestComparison?: NonNullable<CorrectionAppeal["attempts"][number]["comparison"]>;
  readonly availableActions: readonly ("edit" | "record" | "record_only" | "prepare_second_opinion" | "confirm_send" | "cancel" | "resolve" | "retry_with_new_manifest")[];
  readonly userAuthorityOnly: true;
  readonly canAutoResolve: false;
  readonly relatedReceiptHref: string;
}

export interface BriefWorkspaceProjection {
  readonly schemaVersion: typeof RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly briefId: string;
  readonly entityVersion: number;
  readonly active: ResearchBriefVersion;
  readonly versions: readonly ResearchBriefVersion[];
  readonly versionCount: number;
  readonly versionsTruncated: boolean;
  readonly candidates: readonly {
    readonly id: string;
    readonly baseVersionId: string;
    readonly status: BriefChangeStatus;
    readonly changes: BriefChangeSet;
    readonly diffFields: readonly string[];
    readonly reason: string;
    readonly createdAt: string;
    readonly provenance: ProvenanceProjection;
    readonly confirmedAt?: string;
    readonly activatedVersionId?: string;
    readonly diff: readonly {
      readonly field: string;
      readonly change: "added" | "removed" | "changed" | "unchanged";
      readonly before: unknown;
      readonly after: unknown;
    }[];
    readonly impact: {
      readonly highImpactDirectionChange: boolean;
      readonly currentTaskChanged: boolean;
      readonly evidenceBoundaryEffect: "loosened" | "tightened" | "changed" | "unchanged";
      readonly fixedDecisionsChanged: boolean;
      readonly explicitNonGoalsRemoved: readonly string[];
      readonly activeEpisodeIds: readonly string[];
      readonly activeEpisodesTruncated: boolean;
      readonly reviewImpact: "none" | "current_episode_becomes_stale";
      readonly manifestImpact: "none" | "prepared_manifest_must_be_rebuilt";
      readonly expectedEntityVersion: number;
    };
  }[];
  readonly candidateCount: number;
  readonly candidatesTruncated: boolean;
}

export interface AttentionItemProjection {
  readonly id: string;
  readonly kind: "brief_candidate" | "decision" | "issue" | "episode" | "appeal" | "review" | "manifest" | "rollback" | "provider";
  readonly title: string;
  readonly reason: string;
  readonly severity: "high" | "normal";
  readonly href: string;
  readonly primaryAction: string;
  readonly sourceObject: { readonly kind: string; readonly id: string };
  readonly valid: true;
  readonly createdAt: string;
}

export interface TransientAttentionSignal {
  readonly id: string;
  readonly kind: "review" | "manifest" | "rollback" | "provider";
  readonly title: string;
  readonly reason: string;
  readonly severity: "high" | "normal";
  readonly href: string;
  readonly primaryAction: string;
  readonly sourceObject: { readonly kind: string; readonly id: string };
  readonly createdAt: string;
}

export interface AttentionProjection {
  readonly schemaVersion: typeof RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly total: number;
  readonly items: readonly AttentionItemProjection[];
  readonly truncated: boolean;
}

export interface ProjectOverviewProjection {
  readonly schemaVersion: typeof RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION;
  readonly project: { readonly id: string; readonly title: string; readonly version: number; readonly updatedAt: string };
  readonly providerStatus: WorkspaceProviderStatus;
  readonly brief: { readonly id: string; readonly versionId: string; readonly versionNumber: number; readonly question: string; readonly stage: string; readonly task: string };
  readonly counts: { readonly decisions: number; readonly issues: number; readonly evidence: number; readonly episodes: number; readonly receipts: number; readonly appeals: number };
  readonly statuses: {
    readonly decisions: Readonly<Record<string, number>>;
    readonly issues: Readonly<Record<string, number>>;
    readonly evidence: Readonly<Record<string, number>>;
    readonly episodes: Readonly<Record<string, number>>;
    readonly receipts: Readonly<Record<string, number>>;
    readonly appeals: Readonly<Record<string, number>>;
  };
  readonly attention: { readonly total: number; readonly top: readonly AttentionItemProjection[] };
  readonly currentEpisode?: { readonly id: string; readonly status: string; readonly updatedAt: string; readonly href: string };
  readonly latestReceipt?: { readonly id: string; readonly status: string; readonly disposition: string; readonly updatedAt: string; readonly href: string };
  readonly recentChanges: readonly { readonly kind: "brief" | ResearchObjectKind; readonly id: string; readonly label: string; readonly status: string; readonly at: string; readonly href: string }[];
}

export interface ResearchObjectSearchResult {
  readonly kind: ResearchObjectKind | "brief";
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly source: string;
  readonly projectId: string;
  readonly href: string;
}

export interface ResearchObjectSearchProjection {
  readonly schemaVersion: typeof RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly datasetVersion: string;
  readonly query: string;
  readonly items: readonly ResearchObjectSearchResult[];
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

interface WorkspaceCursor {
  readonly version: 1;
  readonly schemaVersion: typeof RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly kind: ResearchObjectKind;
  readonly datasetVersion: string;
  readonly filter: string;
  readonly storeCursor: string;
}

interface SearchCursor {
  readonly version: 1;
  readonly schemaVersion: typeof RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly datasetVersion: string;
  readonly query: string;
  readonly offset: number;
}

type PageReader<T> = (page: ResearchPageRequest) => ResearchResult<ResearchPage<T>>;

function provenance(source: ResearchSource): ProvenanceProjection {
  return Object.freeze({ authority: source.authority, actorKind: source.actor.kind, recordedAt: source.recordedAt });
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function contains(haystack: string, needle: string): boolean {
  return needle.length === 0 || haystack.toLocaleLowerCase("en-US").includes(needle);
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= STORE_PAGE_LIMIT;
}

function encodeCursor(value: WorkspaceCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): WorkspaceCursor | undefined {
  if (value === undefined || value.length === 0 || value.length > 8192) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const item = parsed as Record<string, unknown>;
    const expected = ["datasetVersion", "filter", "kind", "projectId", "schemaVersion", "storeCursor", "version"];
    if (Object.keys(item).sort().some((key, index) => key !== expected[index]) || Object.keys(item).length !== expected.length) return undefined;
    if (item.version !== 1 || item.schemaVersion !== RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION) return undefined;
    if (typeof item.projectId !== "string" || typeof item.datasetVersion !== "string" || typeof item.filter !== "string" || typeof item.storeCursor !== "string") return undefined;
    if (!["decision", "issue", "evidence", "episode", "receipt", "appeal"].includes(String(item.kind))) return undefined;
    return item as unknown as WorkspaceCursor;
  } catch {
    return undefined;
  }
}

function decisionSummary(value: ResearchDecision, currentBriefVersionId: string): DecisionSummaryProjection {
  return Object.freeze({
    kind: "decision",
    id: value.id,
    statement: value.statement,
    status: value.status,
    scope: value.scope,
    rationale: value.rationale,
    effectiveBriefVersionId: value.effectiveBriefVersionId,
    reopenConditions: value.reopenConditions,
    active: value.status === "accepted" || value.status === "frozen",
    referencedByCurrentBrief: value.effectiveBriefVersionId === currentBriefVersionId,
    ...(value.supersedesDecisionId ? { supersedesDecisionId: value.supersedesDecisionId } : {}),
    ...(value.supersededByDecisionId ? { supersededByDecisionId: value.supersededByDecisionId } : {}),
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    provenance: provenance(value.source),
  });
}

function decisionAvailableActions(status: DecisionStatus): DecisionDetailProjection["availableActions"] {
  if (status === "proposed" || status === "deferred") return Object.freeze(["accept", "reject"]);
  if (status === "accepted") return Object.freeze(["freeze", "supersede"]);
  if (status === "frozen") return Object.freeze(["accept", "supersede"]);
  return Object.freeze([]);
}

function issueSummary(value: ResearchIssue): IssueSummaryProjection {
  return Object.freeze({ kind: "issue", id: value.id, issueKind: value.kind, summary: value.summary, status: value.status, violatedCriterion: value.violatedCriterion, fingerprint: value.fingerprint, recurrenceCount: 1 + value.reopenHistory.length, requiresUserAction: ["open", "reopened", "disputed"].includes(value.status), version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt, provenance: provenance(value.source) });
}

function issueAvailableActions(status: IssueStatus): IssueDetailProjection["availableActions"] {
  if (status === "open" || status === "acknowledged" || status === "reopened") return Object.freeze(["resolve", "waive", "dispute"]);
  if (status === "resolved" || status === "suppressed") return Object.freeze(["reopen"]);
  return Object.freeze([]);
}

function evidenceSummary(value: ArgumentEvidence): EvidenceSummaryProjection {
  return Object.freeze({ kind: "evidence", id: value.id, evidenceKind: value.kind, summary: value.summary, state: value.state, inferenceCapacity: value.inferenceCapacity, ...(value.artifactId ? { artifactId: value.artifactId } : {}), ...(value.revisionId ? { revisionId: value.revisionId } : {}), version: value.version, provenance: provenance(value.source) });
}

function episodeSummary(value: RevisionEpisode): EpisodeSummaryProjection {
  return Object.freeze({ kind: "episode", id: value.id, artifactId: value.artifactId, status: value.status, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt, provenance: provenance(value.source) });
}

function receiptSummary(value: ResearchRoomReceipt): ReceiptSummaryProjection {
  return Object.freeze({ kind: "receipt", id: value.id, reviewId: value.reviewId, ...(value.sourceEpisodeId ? { sourceEpisodeId: value.sourceEpisodeId } : {}), status: value.status, providerStatus: value.providerStatus, evidenceClass: value.evidenceClass, disposition: value.disposition, rollback: value.rollback, version: value.version, receiptHash: value.receiptHash, createdAt: value.createdAt, updatedAt: value.updatedAt });
}

function appealSummary(value: CorrectionAppeal): AppealSummaryProjection {
  return Object.freeze({ kind: "appeal", id: value.id, reviewId: value.source.reviewId, sourceReceiptId: value.source.receiptId, findingId: value.source.findingId, criterionId: value.source.rubric.criterionId, status: value.status, disagreement: value.statements.at(-1)?.statement.disagreement ?? "Correction appeal", version: value.version, attemptCount: value.attempts.length, resolutionCount: value.resolutions.length, createdAt: value.createdAt, updatedAt: value.updatedAt });
}

function appealAvailableActions(value: CorrectionAppeal): AppealDetailProjection["availableActions"] {
  if (value.status === "draft") return Object.freeze(["edit", "record"]);
  if (value.status === "recorded") return Object.freeze(["record_only", "prepare_second_opinion", "resolve"]);
  if (value.status === "awaiting_send_confirmation") return Object.freeze(["confirm_send", "cancel"]);
  if (value.status === "second_opinion_running") return Object.freeze(["cancel"]);
  if (value.status === "provider_failed" || value.status === "cancelled") return Object.freeze(["record_only", "retry_with_new_manifest", "resolve"]);
  if (value.status === "appeal_record_only" || value.status === "second_opinion_ready" || value.status === "stale_conflicted" || value.status === "waiting_user_resolution") return Object.freeze(["resolve"]);
  return Object.freeze([]);
}

function filterSignature(request: WorkspaceListRequest): string {
  return JSON.stringify({
    status: request.status ?? "",
    query: normalizeQuery(request.query),
    source: request.source ?? "",
    scope: request.scope ?? "",
    active: request.active ?? null,
    referencedByCurrentBrief: request.referencedByCurrentBrief ?? null,
    issueKind: request.issueKind ?? "",
    relevance: request.relevance ?? "",
    unresolved: request.unresolved ?? null,
    disposition: request.disposition ?? "",
    providerStatus: request.providerStatus ?? "",
  });
}

function sourceMatches(source: ResearchSource, filter: string | undefined): boolean {
  if (filter === undefined) return true;
  return source.actor.kind === filter || source.authority === filter || `${source.authority}:${source.actor.kind}` === filter;
}

function exactBoolean(value: boolean | undefined): boolean { return value === undefined || typeof value === "boolean"; }

function encodeSearchCursor(value: SearchCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeSearchCursor(value: string | undefined): SearchCursor | undefined {
  if (value === undefined || value.length === 0 || value.length > 8192) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const item = parsed as Record<string, unknown>;
    const expected = ["datasetVersion", "offset", "projectId", "query", "schemaVersion", "version"];
    if (Object.keys(item).sort().some((key, index) => key !== expected[index]) || Object.keys(item).length !== expected.length) return undefined;
    if (item.version !== 1 || item.schemaVersion !== RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION || typeof item.projectId !== "string" || typeof item.datasetVersion !== "string" || typeof item.query !== "string" || !Number.isSafeInteger(item.offset) || Number(item.offset) < 0) return undefined;
    return item as unknown as SearchCursor;
  } catch {
    return undefined;
  }
}

export class ResearchObjectWorkspaceService {
  constructor(private readonly store: ResearchStore) {}

  private ensureProject(projectId: string): CoreResult<void> {
    if (!validResearchId(projectId, "rprj_")) return coreErr("invalid_input");
    const project = fromStored(this.store.projects.getById(projectId));
    if (!project.ok) return project;
    return project.value === undefined ? coreErr("not_found") : coreOk(undefined);
  }

  private forEachPaged<T>(reader: PageReader<T>, visit: (item: T) => void): CoreResult<void> {
    let cursor: string | undefined;
    do {
      const page = fromStored(reader({ limit: STORE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }));
      if (!page.ok) return page;
      for (const item of page.value.items) visit(item);
      cursor = page.value.nextCursor;
    } while (cursor !== undefined);
    return coreOk(undefined);
  }

  private relationIds<T>(reader: PageReader<T>, include: (item: T) => boolean, id: (item: T) => string): CoreResult<{ readonly ids: readonly string[]; readonly truncated: boolean }> {
    const ids: string[] = [];
    let matches = 0;
    const scanned = this.forEachPaged(reader, (item) => {
      if (!include(item)) return;
      matches += 1;
      if (ids.length < STORE_PAGE_LIMIT && !ids.includes(id(item))) ids.push(id(item));
    });
    return scanned.ok ? coreOk(Object.freeze({ ids: Object.freeze(ids), truncated: matches > ids.length })) : scanned;
  }

  private currentBrief(projectId: string): CoreResult<{ readonly brief: ResearchBrief; readonly version: ResearchBriefVersion }> {
    let selected: ResearchBrief | undefined;
    let selectedVersion: ResearchBriefVersion | undefined;
    const scanned = this.forEachPaged(this.store.briefs.listByProject.bind(this.store.briefs, projectId), (brief) => {
      const version = brief.importState === undefined ? brief.versions.at(-1) : undefined;
      if (version === undefined) return;
      if (selectedVersion === undefined || version.createdAt > selectedVersion.createdAt || (version.createdAt === selectedVersion.createdAt && brief.id > (selected?.id ?? ""))) {
        selected = brief;
        selectedVersion = version;
      }
    });
    if (!scanned.ok) return scanned;
    return selected !== undefined && selectedVersion !== undefined ? coreOk(Object.freeze({ brief: selected, version: selectedVersion })) : coreErr("not_found");
  }

  private fingerprint<T>(projectId: string, kind: ResearchObjectKind, reader: PageReader<T>, token: (item: T) => unknown): CoreResult<string> {
    const digest = createHash("sha256");
    digest.update(`${RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION}\u0000${projectId}\u0000${kind}\u0000`, "utf8");
    let cursor: string | undefined;
    do {
      const page = fromStored(reader({ limit: STORE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }));
      if (!page.ok) return page;
      for (const item of page.value.items) {
        const serialized = JSON.stringify(token(item));
        digest.update(String(Buffer.byteLength(serialized, "utf8")), "utf8");
        digest.update(":", "utf8");
        digest.update(serialized, "utf8");
        digest.update("\u0000", "utf8");
      }
      cursor = page.value.nextCursor;
    } while (cursor !== undefined);
    return coreOk(digest.digest("hex"));
  }

  private list<T, P>(
    projectId: string,
    kind: ResearchObjectKind,
    request: WorkspaceListRequest,
    reader: PageReader<T>,
    token: (item: T) => unknown,
    include: (item: T, query: string) => boolean,
    project: (item: T) => P,
  ): CoreResult<WorkspacePage<P>> {
    if (!validLimit(request.limit)) return coreErr("invalid_input");
    const exists = this.ensureProject(projectId); if (!exists.ok) return exists;
    const dataset = this.fingerprint(projectId, kind, reader, token); if (!dataset.ok) return dataset;
    const signature = filterSignature(request);
    const decoded = request.cursor === undefined ? undefined : decodeCursor(request.cursor);
    if (request.cursor !== undefined && (decoded?.projectId !== projectId || decoded.kind !== kind || decoded.datasetVersion !== dataset.value || decoded.filter !== signature)) return coreErr("stale_state");
    const query = normalizeQuery(request.query);
    const items: P[] = [];
    let storeCursor = decoded?.storeCursor;
    let nextStoreCursor: string | undefined;
    do {
      const remaining = request.limit - items.length;
      const page = fromStored(reader({ limit: remaining, ...(storeCursor ? { cursor: storeCursor } : {}) }));
      if (!page.ok) return page;
      for (const item of page.value.items) if (include(item, query)) items.push(project(item));
      nextStoreCursor = page.value.nextCursor;
      storeCursor = page.value.nextCursor;
    } while (items.length < request.limit && storeCursor !== undefined);
    const after = this.fingerprint(projectId, kind, reader, token); if (!after.ok) return after;
    if (after.value !== dataset.value) return coreErr("stale_state");
    return coreOk(Object.freeze({
      schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION,
      projectId,
      datasetVersion: dataset.value,
      items: Object.freeze(items),
      ...(nextStoreCursor ? { nextCursor: encodeCursor({ version: 1, schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION, projectId, kind, datasetVersion: dataset.value, filter: signature, storeCursor: nextStoreCursor }) } : {}),
    }));
  }

  getBriefWorkspace(projectId: string, historyLimit = DEFAULT_HISTORY_LIMIT): CoreResult<BriefWorkspaceProjection> {
    if (!validLimit(historyLimit)) return coreErr("invalid_input");
    const exists = this.ensureProject(projectId); if (!exists.ok) return exists;
    const current = this.currentBrief(projectId); if (!current.ok) return current;
    const selected = current.value.brief;
    const active = current.value.version;
    const versions = [...selected.versions].reverse().slice(0, historyLimit);
    const pendingCandidates = [...selected.proposals].reverse().slice(0, historyLimit);
    const trackedVersionIds = new Set(pendingCandidates.map((item) => item.baseVersionId));
    const episodeIds = new Map<string, string[]>();
    const episodeCounts = new Map<string, number>();
    const episodes = this.forEachPaged(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (episode) => {
      const versionId = episode.lockedStart.briefVersionId;
      if (!trackedVersionIds.has(versionId) || ["accepted", "rejected", "abandoned"].includes(episode.status)) return;
      episodeCounts.set(versionId, (episodeCounts.get(versionId) ?? 0) + 1);
      const ids = episodeIds.get(versionId) ?? [];
      if (ids.length < STORE_PAGE_LIMIT) ids.push(episode.id);
      episodeIds.set(versionId, ids);
    });
    if (!episodes.ok) return episodes;
    const fieldNames = ["projectQuestion", "currentStage", "currentTask", "targetArtifacts", "fixedDecisions", "allowedChanges", "forbiddenChanges", "expectedDeltas", "evidenceBoundaries", "explicitNonGoals"] as const;
    const candidates = pendingCandidates.map((item) => {
      const base = selected.versions.find((version) => version.id === item.baseVersionId) ?? active;
      const after = { ...base, ...item.changes };
      const diff = fieldNames.map((field) => {
        const beforeValue = base[field]; const afterValue = after[field];
        const beforeText = JSON.stringify(beforeValue); const afterText = JSON.stringify(afterValue);
        const beforeEmpty = beforeValue === "" || (Array.isArray(beforeValue) && beforeValue.length === 0);
        const afterEmpty = afterValue === "" || (Array.isArray(afterValue) && afterValue.length === 0);
        const change = beforeText === afterText ? "unchanged" as const : beforeEmpty && !afterEmpty ? "added" as const : !beforeEmpty && afterEmpty ? "removed" as const : "changed" as const;
        return Object.freeze({ field, change, before: beforeValue, after: afterValue });
      });
      const beforeBoundaries = base.evidenceBoundaries; const afterBoundaries = after.evidenceBoundaries;
      const evidenceBoundaryEffect = JSON.stringify(beforeBoundaries) === JSON.stringify(afterBoundaries) ? "unchanged" as const : afterBoundaries.length < beforeBoundaries.length ? "loosened" as const : afterBoundaries.length > beforeBoundaries.length ? "tightened" as const : "changed" as const;
      const activeEpisodeIds = episodeIds.get(base.id) ?? [];
      const activeEpisodeCount = episodeCounts.get(base.id) ?? 0;
      const removedNonGoals = base.explicitNonGoals.filter((nonGoal) => !after.explicitNonGoals.includes(nonGoal));
      return Object.freeze({
      id: item.id,
      baseVersionId: item.baseVersionId,
      status: item.status,
      changes: item.changes,
      diffFields: item.diffFields,
      reason: item.reason,
      createdAt: item.createdAt,
      provenance: provenance(item.source),
      ...(item.confirmedAt ? { confirmedAt: item.confirmedAt } : {}),
      ...(item.activatedVersionId ? { activatedVersionId: item.activatedVersionId } : {}),
      diff: Object.freeze(diff),
      impact: Object.freeze({ highImpactDirectionChange: base.projectQuestion !== after.projectQuestion, currentTaskChanged: base.currentTask !== after.currentTask, evidenceBoundaryEffect, fixedDecisionsChanged: JSON.stringify(base.fixedDecisions) !== JSON.stringify(after.fixedDecisions), explicitNonGoalsRemoved: Object.freeze(removedNonGoals), activeEpisodeIds: Object.freeze(activeEpisodeIds), activeEpisodesTruncated: activeEpisodeCount > activeEpisodeIds.length, reviewImpact: activeEpisodeCount > 0 ? "current_episode_becomes_stale" as const : "none" as const, manifestImpact: item.diffFields.length > 0 ? "prepared_manifest_must_be_rebuilt" as const : "none" as const, expectedEntityVersion: selected.version }),
      });
    });
    return coreOk(Object.freeze({ schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION, projectId, briefId: selected.id, entityVersion: selected.version, active, versions: Object.freeze(versions), versionCount: selected.versions.length, versionsTruncated: selected.versions.length > versions.length, candidates: Object.freeze(candidates), candidateCount: selected.proposals.length, candidatesTruncated: selected.proposals.length > candidates.length }));
  }

  listDecisions(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<DecisionSummaryProjection>> {
    const allowed = ["proposed", "accepted", "frozen", "rejected", "deferred", "superseded"];
    if (request.status !== undefined && !allowed.includes(request.status)) return coreErr("invalid_input");
    if (request.scope !== undefined && !["project", "artifact", "brief", "issue"].includes(request.scope)) return coreErr("invalid_input");
    if (!exactBoolean(request.active) || !exactBoolean(request.referencedByCurrentBrief) || request.issueKind !== undefined || request.relevance !== undefined || request.unresolved !== undefined || request.disposition !== undefined || request.providerStatus !== undefined) return coreErr("invalid_input");
    const current = this.currentBrief(projectId); if (!current.ok) return current;
    const briefVersionId = current.value.version.id;
    return this.list(projectId, "decision", request,
      (page) => this.store.decisions.listByScope(projectId, undefined, page),
      (item) => [item.id, item.version, item.status, item.updatedAt],
      (item, query) => (request.status === undefined || item.status === request.status)
        && (request.scope === undefined || item.scope.kind === request.scope)
        && sourceMatches(item.source, request.source)
        && (request.active === undefined || request.active === (item.status === "accepted" || item.status === "frozen"))
        && (request.referencedByCurrentBrief === undefined || request.referencedByCurrentBrief === (item.effectiveBriefVersionId === briefVersionId))
        && (contains(item.statement, query) || contains(item.rationale, query) || item.reopenConditions.some((condition) => contains(condition, query)) || contains(JSON.stringify(item.scope), query)),
      (item) => decisionSummary(item, briefVersionId));
  }

  getDecision(projectId: string, decisionId: string): CoreResult<DecisionDetailProjection | undefined> {
    if (!validResearchId(projectId, "rprj_") || !validResearchId(decisionId, "rdec_")) return coreErr("invalid_input");
    const value = fromStored(this.store.decisions.getById(projectId, decisionId)); if (!value.ok) return value;
    if (value.value === undefined) return coreOk(undefined);
    const current = this.currentBrief(projectId); if (!current.ok) return current;
    const decision = value.value;
    const relatedIssues = this.relationIds(this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (issue) => (decision.scope.kind === "issue" && decision.scope.issueId === issue.id) || Boolean(issue.resolution?.frozenDecisionIds.includes(decisionId)), (issue) => issue.id); if (!relatedIssues.ok) return relatedIssues;
    const relatedEpisodes = this.relationIds(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (episode) => episode.lockedStart.activeDecisions.some((item) => item.decisionId === decisionId), (episode) => episode.id); if (!relatedEpisodes.ok) return relatedEpisodes;
    const relatedReceipts = this.relationIds(this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (receipt) => receipt.before.decisions.some((item) => item.id === decisionId) || receipt.after.decisions.some((item) => item.id === decisionId), (receipt) => receipt.id); if (!relatedReceipts.ok) return relatedReceipts;
    const ancestors: DecisionDetailProjection["lineage"][number][] = [];
    const replacements: DecisionDetailProjection["lineage"][number][] = [];
    const seen = new Set([decision.id]);
    let lineageTruncated = false;
    let ancestorId = decision.supersedesDecisionId;
    while (ancestorId !== undefined && ancestors.length < STORE_PAGE_LIMIT) {
      if (seen.has(ancestorId)) { lineageTruncated = true; break; }
      seen.add(ancestorId);
      const ancestor = fromStored(this.store.decisions.getById(projectId, ancestorId)); if (!ancestor.ok) return ancestor;
      if (ancestor.value === undefined) { lineageTruncated = true; break; }
      ancestors.unshift(Object.freeze({ id: ancestor.value.id, statement: ancestor.value.statement, status: ancestor.value.status, version: ancestor.value.version, relation: "ancestor" as const }));
      ancestorId = ancestor.value.supersedesDecisionId;
    }
    if (ancestorId !== undefined && ancestors.length >= STORE_PAGE_LIMIT) lineageTruncated = true;
    let replacementId = decision.supersededByDecisionId;
    while (replacementId !== undefined && replacements.length < STORE_PAGE_LIMIT) {
      if (seen.has(replacementId)) { lineageTruncated = true; break; }
      seen.add(replacementId);
      const replacement = fromStored(this.store.decisions.getById(projectId, replacementId)); if (!replacement.ok) return replacement;
      if (replacement.value === undefined) { lineageTruncated = true; break; }
      replacements.push(Object.freeze({ id: replacement.value.id, statement: replacement.value.statement, status: replacement.value.status, version: replacement.value.version, relation: "replacement" as const }));
      replacementId = replacement.value.supersededByDecisionId;
    }
    if (replacementId !== undefined && replacements.length >= STORE_PAGE_LIMIT) lineageTruncated = true;
    const lineage = Object.freeze([...ancestors, Object.freeze({ id: decision.id, statement: decision.statement, status: decision.status, version: decision.version, relation: "current" as const }), ...replacements]);
    return coreOk(Object.freeze({
      ...decisionSummary(decision, current.value.version.id),
      availableActions: decisionAvailableActions(decision.status),
      timeline: Object.freeze(decision.transitions.map((transition) => Object.freeze({ from: transition.from, to: transition.to, reason: transition.reason, at: transition.at, provenance: provenance(transition.source) }))),
      lineage,
      lineageTruncated,
      relatedBriefVersionIds: Object.freeze([decision.effectiveBriefVersionId]),
      relatedIssueIds: relatedIssues.value.ids,
      relatedEpisodeIds: relatedEpisodes.value.ids,
      relatedReceiptIds: relatedReceipts.value.ids,
      relationsTruncated: relatedIssues.value.truncated || relatedEpisodes.value.truncated || relatedReceipts.value.truncated,
    }));
  }

  listIssues(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<IssueSummaryProjection>> {
    const allowed = ["open", "acknowledged", "resolved", "suppressed", "disputed", "waived", "reopened"];
    if (request.status !== undefined && !allowed.includes(request.status)) return coreErr("invalid_input");
    if (!exactBoolean(request.unresolved) || request.scope !== undefined || request.active !== undefined || request.referencedByCurrentBrief !== undefined || request.disposition !== undefined || request.providerStatus !== undefined) return coreErr("invalid_input");
    const current = this.currentBrief(projectId); if (!current.ok) return current;
    const targetArtifacts = new Set(current.value.version.targetArtifacts);
    const relevant = (item: ResearchIssue): boolean => item.target.kind === "project_path" || ("artifactId" in item.target && targetArtifacts.has(item.target.artifactId)) || targetArtifacts.has(item.sourceArtifactId);
    return this.list(projectId, "issue", request,
      (page) => this.store.issues.listByStatus(projectId, undefined, page),
      (item) => [item.id, item.version, item.status, item.updatedAt],
      (item, query) => (request.status === undefined || item.status === request.status)
        && (request.issueKind === undefined || item.kind === request.issueKind)
        && sourceMatches(item.source, request.source)
        && (request.relevance === undefined || relevant(item))
        && (request.unresolved === undefined || request.unresolved === ["open", "acknowledged", "disputed", "reopened"].includes(item.status))
        && (contains(item.summary, query) || contains(item.kind, query) || contains(item.violatedCriterion, query) || contains(item.fingerprint, query) || item.rationaleConcepts.some((concept) => contains(concept, query))),
      issueSummary);
  }

  getIssue(projectId: string, issueId: string): CoreResult<IssueDetailProjection | undefined> {
    if (!validResearchId(projectId, "rprj_") || !validResearchId(issueId, "riss_")) return coreErr("invalid_input");
    const value = fromStored(this.store.issues.getById(projectId, issueId)); if (!value.ok) return value;
    if (value.value === undefined) return coreOk(undefined);
    const issue = value.value;
    const current = this.currentBrief(projectId); if (!current.ok) return current;
    const decisions = this.relationIds(this.store.decisions.listByScope.bind(this.store.decisions, projectId, undefined), (decision) => decision.scope.kind === "issue" && decision.scope.issueId === issueId, (decision) => decision.id); if (!decisions.ok) return decisions;
    const episodes = this.relationIds(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (episode) => episode.lockedStart.relevantIssues.some((item) => item.issueId === issueId), (episode) => episode.id); if (!episodes.ok) return episodes;
    const receipts = this.relationIds(this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (receipt) => receipt.before.issues.some((item) => item.id === issueId) || receipt.after.issues.some((item) => item.id === issueId), (receipt) => receipt.id); if (!receipts.ok) return receipts;
    const targetArtifacts = new Set(current.value.version.targetArtifacts);
    const relevantToCurrentBrief = issue.target.kind === "project_path" || ("artifactId" in issue.target && targetArtifacts.has(issue.target.artifactId)) || targetArtifacts.has(issue.sourceArtifactId);
    const relatedBriefVersionIds = [...new Set([...(relevantToCurrentBrief ? [current.value.version.id] : []), ...(issue.resolution?.briefVersionId ? [issue.resolution.briefVersionId] : [])])];
    const resolutionEvidenceId = issue.resolution?.resolutionEvidenceId;
    const relatedEvidenceIds = resolutionEvidenceId?.startsWith("revd_") === true ? [resolutionEvidenceId] : [];
    return coreOk(Object.freeze({
      ...issueSummary(issue),
      availableActions: issueAvailableActions(issue.status),
      target: issue.target,
      rationaleConcepts: issue.rationaleConcepts,
      sourceArtifactId: issue.sourceArtifactId,
      sourceRevisionId: issue.sourceRevisionId,
      sourceRevisionContentHash: issue.sourceRevisionContentHash,
      lineageRootRevisionId: issue.lineageRootRevisionId,
      firstSeenAt: issue.createdAt,
      lastSeenAt: issue.updatedAt,
      ...(issue.resolution ? { resolution: issue.resolution } : {}),
      reopenHistory: issue.reopenHistory,
      timeline: Object.freeze(issue.transitions.map((transition) => Object.freeze({ from: transition.from, to: transition.to, reason: transition.reason, at: transition.at, provenance: provenance(transition.source) }))),
      relatedBriefVersionIds: Object.freeze(relatedBriefVersionIds),
      relatedDecisionIds: decisions.value.ids,
      relatedEvidenceIds: Object.freeze(relatedEvidenceIds),
      relatedEpisodeIds: episodes.value.ids,
      relatedReceiptIds: receipts.value.ids,
      relationsTruncated: decisions.value.truncated || episodes.value.truncated || receipts.value.truncated,
    }));
  }

  listEvidence(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<EvidenceSummaryProjection>> {
    const allowed = ["current", "stale", "disputed"];
    if (request.status !== undefined && !allowed.includes(request.status)) return coreErr("invalid_input");
    if (request.scope !== undefined || request.active !== undefined || request.referencedByCurrentBrief !== undefined || request.issueKind !== undefined || request.relevance !== undefined || request.unresolved !== undefined || request.disposition !== undefined || request.providerStatus !== undefined) return coreErr("invalid_input");
    return this.list(projectId, "evidence", request,
      (page) => this.store.argumentEvidence.listByProject(projectId, page),
      (item) => [item.id, item.version, item.state, item.source.recordedAt],
      (item, query) => (request.status === undefined || item.state === request.status) && sourceMatches(item.source, request.source) && (contains(item.id, query) || contains(item.summary, query) || contains(item.kind, query) || contains(item.inferenceCapacity, query)),
      evidenceSummary);
  }

  getEvidence(projectId: string, evidenceId: string): CoreResult<EvidenceDetailProjection | undefined> {
    if (!validResearchId(projectId, "rprj_") || !validResearchId(evidenceId, "revd_")) return coreErr("invalid_input");
    const value = fromStored(this.store.argumentEvidence.getById(projectId, evidenceId)); if (!value.ok) return value;
    if (value.value === undefined) return coreOk(undefined);
    const claims = fromStored(this.store.claimEvidenceLinks.listByProject(projectId, { limit: STORE_PAGE_LIMIT })); if (!claims.ok) return claims;
    const mechanisms = fromStored(this.store.mechanismEvidenceLinks.listByProject(projectId, { limit: STORE_PAGE_LIMIT })); if (!mechanisms.ok) return mechanisms;
    const claimLinks = claims.value.items.filter((link) => link.evidenceId === evidenceId).map((link) => Object.freeze({ claimId: link.claimId, role: link.role, status: link.status }));
    const mechanismLinks = mechanisms.value.items.filter((link) => link.evidenceId === evidenceId).map((link) => Object.freeze({ mechanismLinkId: link.mechanismLinkId, stepIndex: link.stepIndex, status: link.status }));
    const issues = this.relationIds(this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (issue) => issue.resolution?.resolutionEvidenceId === evidenceId, (issue) => issue.id); if (!issues.ok) return issues;
    const userVerificationState = ["user_recorded", "user_confirmed"].includes(value.value.source.authority) && value.value.source.actor.kind === "user" ? "user_recorded" as const : "not_user_verified" as const;
    return coreOk(Object.freeze({
      ...evidenceSummary(value.value),
      ...(value.value.contentVersionHash ? { contentVersionHash: value.value.contentVersionHash } : {}),
      safeLocator: Object.freeze({ ...(value.value.artifactId ? { artifactId: value.value.artifactId } : {}), ...(value.value.revisionId ? { revisionId: value.value.revisionId } : {}) }),
      capturedAt: value.value.source.recordedAt,
      sensitivity: "not_recorded" as const,
      confidence: "not_recorded" as const,
      uncertainty: `Inference is bounded to ${value.value.inferenceCapacity}.`,
      userVerificationState,
      claimLinks: Object.freeze(claimLinks),
      mechanismLinks: Object.freeze(mechanismLinks),
      relatedBriefVersionIds: Object.freeze([]),
      relatedDecisionIds: Object.freeze([]),
      relatedIssueIds: issues.value.ids,
      relatedEpisodeIds: Object.freeze([]),
      relationsTruncated: claims.value.items.length === STORE_PAGE_LIMIT || mechanisms.value.items.length === STORE_PAGE_LIMIT || issues.value.truncated,
    }));
  }

  listEpisodes(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<EpisodeSummaryProjection>> {
    const allowed = ["draft", "active", "candidate_submitted", "reviewed", "user_action_required", "accepted", "rejected", "abandoned"];
    if (request.status !== undefined && !allowed.includes(request.status)) return coreErr("invalid_input");
    if (request.scope !== undefined || request.active !== undefined || request.referencedByCurrentBrief !== undefined || request.issueKind !== undefined || request.relevance !== undefined || request.unresolved !== undefined || request.disposition !== undefined || request.providerStatus !== undefined) return coreErr("invalid_input");
    return this.list(projectId, "episode", request,
      (page) => this.store.episodes.listByProject(projectId, page),
      (item) => [item.id, item.version, item.status, item.updatedAt],
      (item, query) => (request.status === undefined || item.status === request.status) && sourceMatches(item.source, request.source) && (contains(item.id, query) || contains(item.artifactId, query) || contains(item.status, query) || contains(item.lockedStart.briefVersionId, query)),
      episodeSummary);
  }

  getEpisode(projectId: string, episodeId: string): CoreResult<EpisodeDetailProjection | undefined> {
    if (!validResearchId(projectId, "rprj_") || !validResearchId(episodeId, "repi_")) return coreErr("invalid_input");
    const value = fromStored(this.store.episodes.getById(projectId, episodeId)); if (!value.ok) return value;
    if (value.value === undefined) return coreOk(undefined);
    const episode = value.value;
    const receiptIds: string[] = [];
    const argumentDeltas: EpisodeDetailProjection["argumentDeltas"][number][] = [];
    let receiptCount = 0;
    const receipts = this.forEachPaged(this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (receipt) => {
      if (receipt.sourceEpisodeId !== episodeId) return;
      receiptCount += 1;
      if (receiptIds.length < STORE_PAGE_LIMIT) receiptIds.push(receipt.id);
      if (argumentDeltas.length < STORE_PAGE_LIMIT) argumentDeltas.push(Object.freeze({ receiptId: receipt.id, kind: receipt.analysis.argumentDelta.kind, summary: receipt.analysis.argumentDelta.summary }));
    });
    if (!receipts.ok) return receipts;
    const current = this.currentBrief(projectId); if (!current.ok) return current;
    const lockedVersion = current.value.brief.versions.find((item) => item.id === episode.lockedStart.briefVersionId);
    return coreOk(Object.freeze({
      ...episodeSummary(episode),
      lockedStart: episode.lockedStart,
      lockedStartHash: episode.lockedStartHash,
      ...(episode.candidateRevisionId ? { candidateRevisionId: episode.candidateRevisionId } : {}),
      reviewRunIds: episode.reviewRunIds,
      findingIds: episode.findingIds,
      ...(episode.outcome ? { outcome: episode.outcome } : {}),
      waivers: episode.waivers,
      timeline: episode.transitions,
      ...(lockedVersion ? { lockedBrief: Object.freeze({ versionId: lockedVersion.id, stage: lockedVersion.currentStage, task: lockedVersion.currentTask }) } : {}),
      argumentDeltas: Object.freeze(argumentDeltas),
      relatedDecisionIds: Object.freeze(episode.lockedStart.activeDecisions.map((item) => item.decisionId)),
      relatedIssueIds: Object.freeze(episode.lockedStart.relevantIssues.map((item) => item.issueId)),
      relatedReceiptIds: Object.freeze(receiptIds),
      relationsTruncated: receiptCount > receiptIds.length,
    }));
  }

  listReceipts(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<ReceiptSummaryProjection>> {
    const allowed = ["committed", "rolled_back"];
    if (request.status !== undefined && !allowed.includes(request.status)) return coreErr("invalid_input");
    if (request.providerStatus !== undefined && !["semantic_ready", "ledger_only"].includes(request.providerStatus)) return coreErr("invalid_input");
    if (request.scope !== undefined || request.source !== undefined || request.active !== undefined || request.referencedByCurrentBrief !== undefined || request.issueKind !== undefined || request.relevance !== undefined || request.unresolved !== undefined) return coreErr("invalid_input");
    return this.list(projectId, "receipt", request,
      (page) => this.store.roomReceipts.listByProject(projectId, page),
      (item) => [item.id, item.version, item.status, item.updatedAt, item.receiptHash],
      (item, query) => (request.status === undefined || item.status === request.status)
        && (request.disposition === undefined || item.disposition.kind === request.disposition)
        && (request.providerStatus === undefined || item.providerStatus === request.providerStatus)
        && (contains(item.id, query) || contains(item.reviewId, query) || contains(item.disposition.kind, query) || contains(item.disposition.reason, query) || contains(item.analysis.argumentDelta.summary, query)),
      receiptSummary);
  }

  getReceipt(projectId: string, receiptId: string): CoreResult<ReceiptDetailProjection | undefined> {
    if (!validResearchId(projectId, "rprj_") || !validResearchId(receiptId, "rrcp_")) return coreErr("invalid_input");
    const value = fromStored(this.store.roomReceipts.getById(projectId, receiptId)); if (!value.ok) return value;
    if (value.value === undefined) return coreOk(undefined);
    const receipt = value.value;
    const relatedBriefVersionIds = [...new Set([receipt.before.briefVersionId, receipt.after.briefVersionId])];
    const relatedDecisionIds = [...new Set([...receipt.before.decisions.map((item) => item.id), ...receipt.after.decisions.map((item) => item.id)])];
    const relatedIssueIds = [...new Set([...receipt.before.issues.map((item) => item.id), ...receipt.after.issues.map((item) => item.id)])];
    const relatedAppeals: ReceiptDetailProjection["correctionAppeals"][number][] = [];
    const appeals = this.forEachPaged(this.store.correctionAppeals.listByProject.bind(this.store.correctionAppeals, projectId), (appeal) => {
      if (appeal.source.receiptId === receiptId) relatedAppeals.push(Object.freeze({ appealId: appeal.id, findingId: appeal.source.findingId, status: appeal.status, updatedAt: appeal.updatedAt, href: `/project/appeals/${appeal.id}` }));
    });
    if (!appeals.ok) return appeals;
    relatedAppeals.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.appealId.localeCompare(right.appealId));
    const appealByFinding = new Map(relatedAppeals.map((appeal) => [appeal.findingId, appeal]));
    const appealableFindings: ReceiptDetailProjection["appealableFindings"] = Object.freeze((receipt.semanticJudge?.findings ?? []).map((finding) => {
      const appeal = appealByFinding.get(finding.id);
      if (appeal !== undefined) return Object.freeze({ findingId: finding.id, kind: finding.kind, severity: finding.severity, appealId: appeal.appealId, action: "open_appeal" as const, href: appeal.href });
      if (!APPEALABLE_FINDING_KINDS.has(finding.kind)) return Object.freeze({ findingId: finding.id, kind: finding.kind, severity: finding.severity, action: "unavailable" as const, unavailableReason: "criterion_binding_unavailable" as const });
      return Object.freeze({ findingId: finding.id, kind: finding.kind, severity: finding.severity, action: "create_appeal" as const, href: `/project/appeals/new?receipt=${encodeURIComponent(receipt.id)}&finding=${encodeURIComponent(finding.id)}` });
    }));
    const trace: ReceiptDetailProjection["trace"] = Object.freeze([
      Object.freeze({ step: "suggestion" as const, summary: `Suggestion hash ${receipt.suggestionHash.slice(0, 12)}` }),
      Object.freeze({ step: "context_manifest" as const, summary: `${receipt.manifest.fields.length} explicit context fields; ${receipt.manifest.sendStatus}` }),
      Object.freeze({ step: "provider_or_ledger" as const, summary: receipt.ledgerOnlyReason ? `${receipt.providerStatus}: ${receipt.ledgerOnlyReason}` : receipt.providerStatus }),
      Object.freeze({ step: "assessment" as const, summary: `${receipt.semanticJudge?.assessments.length ?? 0} semantic assessments` }),
      Object.freeze({ step: "finding_and_delta" as const, summary: `${receipt.analysis.findings.length} findings; ${receipt.analysis.argumentDelta.summary}` }),
      Object.freeze({ step: "user_disposition" as const, summary: `${receipt.disposition.kind}: ${receipt.disposition.reason}` }),
      Object.freeze({ step: "state_change" as const, summary: `${receipt.before.stateHash.slice(0, 12)} -> ${receipt.after.stateHash.slice(0, 12)}` }),
      Object.freeze({ step: "receipt" as const, summary: `${receipt.id} is ${receipt.status}` }),
      Object.freeze({ step: "correction_appeal" as const, summary: relatedAppeals.length === 0 ? "No correction appeal has been recorded for this receipt." : `${relatedAppeals.length} correction appeal record(s) are linked to this receipt.` }),
      Object.freeze({ step: "rollback" as const, summary: receipt.rollback.available ? "Rollback remains available with a new explicit user action." : receipt.rollback.rolledBackAt ? `Rolled back at ${receipt.rollback.rolledBackAt}` : "Rollback is unavailable." }),
    ]);
    return coreOk(Object.freeze({ ...receiptSummary(receipt), countsAsExternalEvidence: false, ...(receipt.ledgerOnlyReason ? { ledgerOnlyReason: receipt.ledgerOnlyReason } : {}), suggestionHash: receipt.suggestionHash, argumentDelta: receipt.analysis.argumentDelta, findings: receipt.analysis.findings, alternativeExplanations: receipt.analysis.alternativeExplanations, unknowns: receipt.analysis.unknowns, unproven: receipt.analysis.unproven, minimalCorrection: receipt.analysis.minimalCorrection, contextFields: Object.freeze(receipt.manifest.fields.map((field) => Object.freeze({ category: field.category, source: field.source, sensitivity: field.sensitivity, truncated: field.truncated }))), network: Object.freeze({ required: receipt.manifest.networkRequired, used: receipt.manifest.networkUsed, sendStatus: receipt.manifest.sendStatus }), authority: receipt.authority, beforeStateHash: receipt.before.stateHash, afterStateHash: receipt.after.stateHash, relatedBriefVersionIds: Object.freeze(relatedBriefVersionIds), relatedDecisionIds: Object.freeze(relatedDecisionIds), relatedIssueIds: Object.freeze(relatedIssueIds), correctionAppeals: Object.freeze(relatedAppeals), appealableFindings, trace }));
  }

  listAppeals(projectId: string, request: WorkspaceListRequest): CoreResult<WorkspacePage<AppealSummaryProjection>> {
    if (request.scope !== undefined || request.source !== undefined || request.active !== undefined || request.referencedByCurrentBrief !== undefined || request.issueKind !== undefined || request.relevance !== undefined || request.unresolved !== undefined || request.disposition !== undefined || request.providerStatus !== undefined) return coreErr("invalid_input");
    return this.list(projectId, "appeal", request,
      (page) => this.store.correctionAppeals.listByProject(projectId, page),
      (item) => [item.id, item.version, item.status, item.updatedAt, item.source.findingHash, item.attempts.length, item.resolutions.length],
      (item, query) => (request.status === undefined || item.status === request.status)
        && (contains(item.id, query) || contains(item.source.reviewId, query) || contains(item.source.receiptId, query) || contains(item.source.findingId, query) || contains(item.source.rubric.criterionId, query) || item.statements.some((statement) => contains(statement.statement.disagreement, query) || contains(statement.statement.claimedError, query) || contains(statement.statement.missingOrMisreadContext, query) || contains(statement.statement.secondOpinionQuestion, query)) || item.resolutions.some((resolution) => contains(resolution.publicReason, query))),
      appealSummary);
  }

  getAppeal(projectId: string, appealId: string): CoreResult<AppealDetailProjection | undefined> {
    if (!validResearchId(projectId, "rprj_") || !validResearchId(appealId, "rapl_")) return coreErr("invalid_input");
    const value = fromStored(this.store.correctionAppeals.getById(projectId, appealId)); if (!value.ok) return value;
    if (value.value === undefined) return coreOk(undefined);
    const appeal = value.value;
    const latestComparison = [...appeal.attempts].reverse().find((attempt) => attempt.comparison !== undefined)?.comparison;
    return coreOk(Object.freeze({ ...appealSummary(appeal), source: appeal.source, lineage: appeal.lineage, statements: appeal.statements, attempts: appeal.attempts, resolutions: appeal.resolutions, timeline: appeal.transitions, ...(latestComparison ? { latestComparison } : {}), availableActions: appealAvailableActions(appeal), userAuthorityOnly: true as const, canAutoResolve: false as const, relatedReceiptHref: `/project/receipts/${appeal.source.receiptId}` }));
  }

  private statusCount<T>(reader: PageReader<T>, status: (item: T) => string): CoreResult<{ readonly total: number; readonly statuses: Readonly<Record<string, number>> }> {
    const counts: Record<string, number> = {};
    let total = 0;
    let cursor: string | undefined;
    do {
      const page = fromStored(reader({ limit: STORE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }));
      if (!page.ok) return page;
      for (const item of page.value.items) { const key = status(item); counts[key] = (counts[key] ?? 0) + 1; total += 1; }
      cursor = page.value.nextCursor;
    } while (cursor !== undefined);
    return coreOk(Object.freeze({ total, statuses: Object.freeze(counts) }));
  }

  private recent<T, P>(reader: PageReader<T>, project: (item: T) => P, at: (item: T) => string, limit = 10): CoreResult<readonly P[]> {
    const kept: { readonly item: T; readonly at: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = fromStored(reader({ limit: STORE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) })); if (!page.ok) return page;
      for (const item of page.value.items) {
        kept.push({ item, at: at(item) }); kept.sort((left, right) => right.at.localeCompare(left.at));
        if (kept.length > limit) kept.length = limit;
      }
      cursor = page.value.nextCursor;
    } while (cursor !== undefined);
    return coreOk(Object.freeze(kept.map((entry) => project(entry.item))));
  }

  getAttention(projectId: string, transient: readonly TransientAttentionSignal[] = []): CoreResult<AttentionProjection> {
    const exists = this.ensureProject(projectId); if (!exists.ok) return exists;
    const items: AttentionItemProjection[] = [];
    let total = 0;
    const add = (item: Omit<AttentionItemProjection, "valid">) => { total += 1; if (items.length < ATTENTION_LIMIT) items.push(Object.freeze({ ...item, valid: true as const })); };
    const briefs = this.forEachPaged(this.store.briefs.listByProject.bind(this.store.briefs, projectId), (brief) => {
      for (const candidate of brief.proposals) if (candidate.status === "pending") add({ id: candidate.id, kind: "brief_candidate", title: "Research Brief candidate", reason: candidate.reason, severity: "high", href: `/project/brief?candidate=${encodeURIComponent(candidate.id)}`, primaryAction: "Review field diff and activate or leave pending", sourceObject: Object.freeze({ kind: "brief_candidate", id: candidate.id }), createdAt: candidate.createdAt });
    }); if (!briefs.ok) return briefs;
    const decisions = this.forEachPaged(this.store.decisions.listByScope.bind(this.store.decisions, projectId, undefined), (decision) => {
      if (["proposed", "deferred"].includes(decision.status)) add({ id: decision.id, kind: "decision", title: decision.statement, reason: `Decision is ${decision.status}.`, severity: "high", href: `/project/decisions/${decision.id}`, primaryAction: "Open Decision Authority Gate", sourceObject: Object.freeze({ kind: "decision", id: decision.id }), createdAt: decision.createdAt });
    }); if (!decisions.ok) return decisions;
    const issues = this.forEachPaged(this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (issue) => {
      if (["open", "reopened", "disputed"].includes(issue.status)) add({ id: issue.id, kind: "issue", title: issue.summary, reason: `Issue is ${issue.status}.`, severity: "high", href: `/project/issues/${issue.id}`, primaryAction: "Open Issue and choose an explicit disposition", sourceObject: Object.freeze({ kind: "issue", id: issue.id }), createdAt: issue.createdAt });
    }); if (!issues.ok) return issues;
    const episodes = this.forEachPaged(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (episode) => {
      if (episode.status === "user_action_required") add({ id: episode.id, kind: "episode", title: `Episode ${episode.id}`, reason: "This episode requires a user disposition.", severity: "high", href: `/project/episodes/${episode.id}`, primaryAction: "Open Episode context and outcome", sourceObject: Object.freeze({ kind: "episode", id: episode.id }), createdAt: episode.createdAt });
    }); if (!episodes.ok) return episodes;
    const appeals = this.forEachPaged(this.store.correctionAppeals.listByProject.bind(this.store.correctionAppeals, projectId), (appeal) => {
      if (appeal.status === "resolved") return;
      const action = appeal.status === "draft" ? "Finish and record the correction appeal"
        : appeal.status === "awaiting_send_confirmation" ? "Inspect the exact Manifest and explicitly confirm or cancel"
          : appeal.status === "second_opinion_running" ? "Monitor or cancel the second-opinion attempt"
            : appeal.status === "second_opinion_ready" ? "Compare the independent assessment and make the user resolution"
              : appeal.status === "provider_failed" || appeal.status === "cancelled" ? "Record only, prepare a fresh manual retry, or resolve"
                : "Open the appeal and choose an explicit user resolution";
      add({ id: appeal.id, kind: "appeal", title: `Correction appeal · ${appeal.source.rubric.criterionId}`, reason: `Appeal is ${appeal.status}.`, severity: ["draft", "awaiting_send_confirmation", "second_opinion_ready", "stale_conflicted"].includes(appeal.status) ? "high" : "normal", href: `/project/appeals/${appeal.id}`, primaryAction: action, sourceObject: Object.freeze({ kind: "appeal", id: appeal.id }), createdAt: appeal.updatedAt });
    }); if (!appeals.ok) return appeals;
    for (const signal of transient) add({ ...signal });
    items.sort((left, right) => (left.severity === right.severity ? right.createdAt.localeCompare(left.createdAt) : left.severity === "high" ? -1 : 1) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    return coreOk(Object.freeze({ schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION, projectId, total, items: Object.freeze(items), truncated: total > items.length }));
  }

  getOverview(projectId: string, input: { readonly providerStatus: WorkspaceProviderStatus }, transient: readonly TransientAttentionSignal[] = []): CoreResult<ProjectOverviewProjection> {
    if (!["configured", "ledger_only"].includes(input.providerStatus)) return coreErr("invalid_input");
    const exists = this.ensureProject(projectId); if (!exists.ok) return exists;
    const project = fromStored(this.store.projects.getById(projectId)); if (!project.ok) return project;
    if (project.value === undefined) return coreErr("not_found");
    const brief = this.getBriefWorkspace(projectId, 1); if (!brief.ok) return brief;
    const decisions = this.statusCount(this.store.decisions.listByScope.bind(this.store.decisions, projectId, undefined), (item) => item.status); if (!decisions.ok) return decisions;
    const issues = this.statusCount(this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (item) => item.status); if (!issues.ok) return issues;
    const evidence = this.statusCount(this.store.argumentEvidence.listByProject.bind(this.store.argumentEvidence, projectId), (item) => item.state); if (!evidence.ok) return evidence;
    const episodes = this.statusCount(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (item) => item.status); if (!episodes.ok) return episodes;
    const receipts = this.statusCount(this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (item) => item.status); if (!receipts.ok) return receipts;
    const appeals = this.statusCount(this.store.correctionAppeals.listByProject.bind(this.store.correctionAppeals, projectId), (item) => item.status); if (!appeals.ok) return appeals;
    const attention = this.getAttention(projectId, transient); if (!attention.ok) return attention;
    const recentDecisions = this.recent(this.store.decisions.listByScope.bind(this.store.decisions, projectId, undefined), (item) => ({ kind: "decision" as const, id: item.id, label: item.statement, status: item.status, at: item.updatedAt, href: `/project/decisions/${item.id}` }), (item) => item.updatedAt, 10); if (!recentDecisions.ok) return recentDecisions;
    const recentIssues = this.recent(this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (item) => ({ kind: "issue" as const, id: item.id, label: item.summary, status: item.status, at: item.updatedAt, href: `/project/issues/${item.id}` }), (item) => item.updatedAt, 10); if (!recentIssues.ok) return recentIssues;
    const recentEpisodes = this.recent(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (item) => ({ kind: "episode" as const, id: item.id, label: `Episode ${item.id}`, status: item.status, at: item.updatedAt, href: `/project/episodes/${item.id}` }), (item) => item.updatedAt, 10); if (!recentEpisodes.ok) return recentEpisodes;
    const recentReceipts = this.recent(this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (item) => ({ kind: "receipt" as const, id: item.id, label: item.analysis.argumentDelta.summary, status: item.status, disposition: item.disposition.kind, at: item.updatedAt, href: `/project/receipts/${item.id}` }), (item) => item.updatedAt, 10); if (!recentReceipts.ok) return recentReceipts;
    const recentAppeals = this.recent(this.store.correctionAppeals.listByProject.bind(this.store.correctionAppeals, projectId), (item) => ({ kind: "appeal" as const, id: item.id, label: item.statements.at(-1)?.statement.disagreement ?? `Appeal ${item.id}`, status: item.status, at: item.updatedAt, href: `/project/appeals/${item.id}` }), (item) => item.updatedAt, 10); if (!recentAppeals.ok) return recentAppeals;
    const currentEpisode = recentEpisodes.value.find((item) => !["accepted", "rejected", "abandoned"].includes(item.status)) ?? recentEpisodes.value[0];
    const latestReceipt = recentReceipts.value[0];
    const briefChanges = [brief.value.active, ...brief.value.versions.slice(1)].map((version) => ({ kind: "brief" as const, id: version.id, label: version.currentTask, status: version.id === brief.value.active.id ? "active" : "historical", at: version.createdAt, href: "/project/brief" }));
    const recentChanges = [...briefChanges, ...recentDecisions.value, ...recentIssues.value, ...recentEpisodes.value, ...recentReceipts.value, ...recentAppeals.value].sort((left, right) => right.at.localeCompare(left.at) || left.id.localeCompare(right.id)).slice(0, 10);
    return coreOk(Object.freeze({
      schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION,
      project: Object.freeze({ id: project.value.id, title: project.value.title, version: project.value.version, updatedAt: project.value.updatedAt }),
      providerStatus: input.providerStatus,
      brief: Object.freeze({ id: brief.value.briefId, versionId: brief.value.active.id, versionNumber: brief.value.active.versionNumber, question: brief.value.active.projectQuestion, stage: brief.value.active.currentStage, task: brief.value.active.currentTask }),
      counts: Object.freeze({ decisions: decisions.value.total, issues: issues.value.total, evidence: evidence.value.total, episodes: episodes.value.total, receipts: receipts.value.total, appeals: appeals.value.total }),
      statuses: Object.freeze({ decisions: decisions.value.statuses, issues: issues.value.statuses, evidence: evidence.value.statuses, episodes: episodes.value.statuses, receipts: receipts.value.statuses, appeals: appeals.value.statuses }),
      attention: Object.freeze({ total: attention.value.total, top: attention.value.items.slice(0, 5) }),
      ...(currentEpisode ? { currentEpisode: Object.freeze({ id: currentEpisode.id, status: currentEpisode.status, updatedAt: currentEpisode.at, href: currentEpisode.href }) } : {}),
      ...(latestReceipt ? { latestReceipt: Object.freeze({ id: latestReceipt.id, status: latestReceipt.status, disposition: latestReceipt.disposition, updatedAt: latestReceipt.at, href: latestReceipt.href }) } : {}),
      recentChanges: Object.freeze(recentChanges),
    }));
  }

  private searchDatasetVersion(projectId: string): CoreResult<string> {
    const brief = this.currentBrief(projectId); if (!brief.ok) return brief;
    const decisions = this.fingerprint(projectId, "decision", this.store.decisions.listByScope.bind(this.store.decisions, projectId, undefined), (item) => [item.id, item.version, item.status, item.updatedAt]); if (!decisions.ok) return decisions;
    const issues = this.fingerprint(projectId, "issue", this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (item) => [item.id, item.version, item.status, item.updatedAt]); if (!issues.ok) return issues;
    const evidence = this.fingerprint(projectId, "evidence", this.store.argumentEvidence.listByProject.bind(this.store.argumentEvidence, projectId), (item) => [item.id, item.version, item.state, item.source.recordedAt]); if (!evidence.ok) return evidence;
    const episodes = this.fingerprint(projectId, "episode", this.store.episodes.listByProject.bind(this.store.episodes, projectId), (item) => [item.id, item.version, item.status, item.updatedAt]); if (!episodes.ok) return episodes;
    const receipts = this.fingerprint(projectId, "receipt", this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (item) => [item.id, item.version, item.status, item.updatedAt, item.receiptHash]); if (!receipts.ok) return receipts;
    const appeals = this.fingerprint(projectId, "appeal", this.store.correctionAppeals.listByProject.bind(this.store.correctionAppeals, projectId), (item) => [item.id, item.version, item.status, item.updatedAt, item.source.findingHash, item.attempts.length, item.resolutions.length]); if (!appeals.ok) return appeals;
    return coreOk(createHash("sha256").update(JSON.stringify({ brief: [brief.value.brief.id, brief.value.brief.version, brief.value.version.id], decisions: decisions.value, issues: issues.value, evidence: evidence.value, episodes: episodes.value, receipts: receipts.value, appeals: appeals.value }), "utf8").digest("hex"));
  }

  search(projectId: string, input: { readonly query: string; readonly limit: number; readonly cursor?: string }): CoreResult<ResearchObjectSearchProjection> {
    if (!validLimit(input.limit) || typeof input.query !== "string" || input.query.length > 512) return coreErr("invalid_input");
    const exists = this.ensureProject(projectId); if (!exists.ok) return exists;
    const query = normalizeQuery(input.query);
    const datasetVersion = this.searchDatasetVersion(projectId); if (!datasetVersion.ok) return datasetVersion;
    const decoded = input.cursor === undefined ? undefined : decodeSearchCursor(input.cursor);
    if (input.cursor !== undefined && (decoded?.projectId !== projectId || decoded.datasetVersion !== datasetVersion.value || decoded.query !== query)) return coreErr("stale_state");
    const offset = decoded?.offset ?? 0;
    if (query.length === 0) return coreOk(Object.freeze({ schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION, projectId, datasetVersion: datasetVersion.value, query: "", items: Object.freeze([]), truncated: false }));
    const found: ResearchObjectSearchResult[] = [];
    let matches = 0;
    const add = (value: ResearchObjectSearchResult) => { const index = matches; matches += 1; if (index >= offset && found.length < input.limit) found.push(Object.freeze(value)); };
    const brief = this.getBriefWorkspace(projectId, 1);
    if (!brief.ok) return brief;
    const active = brief.value.active;
    if ([active.projectQuestion, active.currentTask, active.currentStage, ...active.explicitNonGoals, ...active.fixedDecisions.map((item) => item.statement), ...active.evidenceBoundaries.map((item) => item.statement)].some((item) => contains(item, query))) add({ kind: "brief", id: brief.value.briefId, title: active.projectQuestion, detail: active.currentTask, status: "active", source: `${active.source.authority}:${active.source.actor.kind}`, projectId, href: "/project/brief" });
    const decisions = this.forEachPaged(this.store.decisions.listByScope.bind(this.store.decisions, projectId, undefined), (item) => {
      if (contains(item.id, query) || contains(item.statement, query) || contains(item.rationale, query) || item.reopenConditions.some((condition) => contains(condition, query))) add({ kind: "decision", id: item.id, title: item.statement, detail: item.rationale, status: item.status, source: `${item.source.authority}:${item.source.actor.kind}`, projectId, href: `/project/decisions/${item.id}` });
    }); if (!decisions.ok) return decisions;
    const issues = this.forEachPaged(this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (item) => {
      if (contains(item.id, query) || contains(item.summary, query) || contains(item.kind, query) || contains(item.violatedCriterion, query) || contains(item.fingerprint, query)) add({ kind: "issue", id: item.id, title: item.summary, detail: `${item.kind} · ${item.violatedCriterion}`, status: item.status, source: `${item.source.authority}:${item.source.actor.kind}`, projectId, href: `/project/issues/${item.id}` });
    }); if (!issues.ok) return issues;
    const evidence = this.forEachPaged(this.store.argumentEvidence.listByProject.bind(this.store.argumentEvidence, projectId), (item) => {
      if (contains(item.id, query) || contains(item.summary, query) || contains(item.kind, query)) add({ kind: "evidence", id: item.id, title: item.summary, detail: `${item.kind} · ${item.inferenceCapacity}`, status: item.state, source: `${item.source.authority}:${item.source.actor.kind}`, projectId, href: `/project/evidence/${item.id}` });
    }); if (!evidence.ok) return evidence;
    const episodes = this.forEachPaged(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (item) => {
      if (contains(item.id, query) || contains(item.status, query) || contains(item.artifactId, query)) add({ kind: "episode", id: item.id, title: `Episode ${item.id}`, detail: item.artifactId, status: item.status, source: `${item.source.authority}:${item.source.actor.kind}`, projectId, href: `/project/episodes/${item.id}` });
    }); if (!episodes.ok) return episodes;
    const receipts = this.forEachPaged(this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (item) => {
      if (contains(item.id, query) || contains(item.reviewId, query) || contains(item.analysis.argumentDelta.summary, query) || contains(item.disposition.reason, query)) add({ kind: "receipt", id: item.id, title: `Receipt ${item.id}`, detail: item.analysis.argumentDelta.summary, status: item.status, source: `user_confirmed:${item.authority.actor.kind}`, projectId, href: `/project/receipts/${item.id}` });
    }); if (!receipts.ok) return receipts;
    const appeals = this.forEachPaged(this.store.correctionAppeals.listByProject.bind(this.store.correctionAppeals, projectId), (item) => {
      const statement = item.statements.at(-1)?.statement;
      if (contains(item.id, query) || contains(item.source.reviewId, query) || contains(item.source.receiptId, query) || contains(item.source.findingId, query) || contains(item.source.rubric.criterionId, query) || statement !== undefined && [statement.disagreement, statement.claimedError, statement.missingOrMisreadContext, statement.secondOpinionQuestion].some((field) => contains(field, query)) || item.resolutions.some((resolution) => contains(resolution.publicReason, query))) add({ kind: "appeal", id: item.id, title: `Correction appeal · ${item.source.rubric.criterionId}`, detail: statement?.disagreement ?? "Correction appeal", status: item.status, source: "user_recorded:user", projectId, href: `/project/appeals/${item.id}` });
    }); if (!appeals.ok) return appeals;
    const nextOffset = offset + found.length;
    const hasMore = matches > nextOffset;
    return coreOk(Object.freeze({ schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION, projectId, datasetVersion: datasetVersion.value, query: input.query.trim(), items: Object.freeze(found), ...(hasMore ? { nextCursor: encodeSearchCursor({ version: 1, schemaVersion: RESEARCH_OBJECT_WORKSPACE_SCHEMA_VERSION, projectId, datasetVersion: datasetVersion.value, query, offset: nextOffset }) } : {}), truncated: hasMore }));
  }
}
