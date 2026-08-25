import { randomBytes } from "node:crypto";
import {
  createBriefChangeProposal,
  confirmBriefChangeProposal,
  createResearchRoomReceipt,
  getActiveResearchBriefVersion,
  parseResearchRoomEvidenceClass,
  parseResearchRoomStateBinding,
  parseEntityVersion,
  parseResearchSource,
  rollBackResearchRoomReceipt,
  stableResearchHash,
  validateResearchActor,
  type Clock,
  type IdFactory,
  type ResearchActor,
  type ResearchBrief,
  type ResearchBriefVersion,
  type ResearchDecision,
  type ResearchIssue,
  type ResearchRoomAnalysisPayload,
  type ResearchRoomContextManifest,
  type ResearchRoomDispositionKind,
  type ResearchRoomEvidenceClass,
  type ResearchRoomReceipt,
  type ResearchRoomSemanticJudgeTrace,
  type ResearchRoomStateBinding,
  type ResearchPage,
  type ResearchPageRequest,
  type ResearchResult,
  type RevisionEpisode,
} from "@sestina/research";
import {
  prepareResearchRoomSemanticJudge,
  submitResearchRoomSemanticJudge,
  type ResearchRoomSemanticJudgeRequest,
  type ResearchRoomSemanticJudgeResult,
  type ResearchRoomSemanticProviderBinding,
} from "@sestina/review";
import type { ResearchStore } from "@sestina/research-store";
import { coreErr, coreOk, fromDomain, type CoreResult } from "./errors.js";
import type { TransientAttentionSignal } from "./research-object-workspaces.js";

const PAGE = Object.freeze({ limit: 200 });
const MAX_SUGGESTION_BYTES = 16_384;

export interface ResearchRoomProvider {
  readonly id: string;
  readonly kind: "deterministic_fixture" | "local" | "external";
  readonly networkAccess: "none" | "loopback" | "external";
  readonly binding: ResearchRoomSemanticProviderBinding;
  prepare(request: ResearchRoomSemanticJudgeRequest): ResearchRoomProviderInput;
  analyze(request: ResearchRoomSemanticJudgeRequest, preview: ResearchRoomProviderInput, options: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface ResearchRoomProviderInput {
  readonly schemaVersion: "1.0.0";
  readonly endpoint: string;
  readonly provider: ResearchRoomSemanticProviderBinding;
  readonly requestHash: string;
  readonly requestBody: string;
  readonly requestBodyHash: string;
  readonly requestBodyBytes: number;
  readonly responseLimitBytes: number;
  readonly redirectPolicy: "error";
  readonly retryCount: 0;
}

export interface ResearchRoomState {
  readonly project: { readonly id: string; readonly title: string };
  readonly brief: {
    readonly id: string;
    readonly versionId: string;
    readonly versionNumber: number;
    readonly projectQuestion: string;
    readonly currentStage: string;
    readonly currentTask: string;
    readonly fixedDecisions: readonly { readonly id: string; readonly statement: string }[];
    readonly expectedDeltas: readonly { readonly id: string; readonly statement: string }[];
    readonly explicitNonGoals: readonly string[];
  };
  readonly decisions: readonly { readonly id: string; readonly statement: string; readonly rationale: string; readonly status: "accepted" | "frozen"; readonly version: number }[];
  readonly issues: readonly { readonly id: string; readonly kind: string; readonly summary: string; readonly status: string; readonly version: number }[];
  readonly currentEpisode?: { readonly id: string; readonly status: string; readonly version: number; readonly artifactId: string; readonly createdAt: string };
  readonly stateBinding: ResearchRoomStateBinding;
  readonly receipts: readonly ResearchRoomReceipt[];
}

export interface PrepareResearchRoomReviewInput {
  readonly projectId: string;
  readonly suggestion: string;
  readonly evidenceClass: ResearchRoomEvidenceClass;
  readonly countsAsExternalEvidence: boolean;
}

export interface PreparedResearchRoomReview {
  readonly reviewId: string;
  readonly contextManifestVisible: true;
  readonly providerStatus: "ready" | "ledger_only";
  readonly manifest: ResearchRoomContextManifest;
  readonly manifestHash: string;
  readonly confirmationNonce: string;
  readonly stateBinding: ResearchRoomStateBinding;
}

export interface AnalyzedResearchRoomReview {
  readonly reviewId: string;
  readonly providerStatus: "semantic_ready" | "ledger_only";
  readonly ledgerOnlyReason?: "provider_not_configured" | "provider_failed" | "provider_timeout" | "provider_invalid_response" | "provider_configuration_changed" | "provider_aborted";
  readonly manifest: ResearchRoomContextManifest;
  readonly analysis: ResearchRoomAnalysisPayload;
  readonly semanticJudge?: ResearchRoomSemanticJudgeTrace;
  readonly authorityNonce: string;
  readonly stateBinding: ResearchRoomStateBinding;
}

export interface CommitResearchRoomDispositionInput {
  readonly projectId: string;
  readonly reviewId: string;
  readonly authorityNonce: string;
  readonly expectedStateBinding: ResearchRoomStateBinding;
  readonly disposition: ResearchRoomDispositionKind;
  readonly reason: string;
  readonly modifiedProposal?: string;
  readonly redirectQuestion?: string;
  readonly actor: ResearchActor;
}

export interface RollbackResearchRoomReceiptInput {
  readonly projectId: string;
  readonly receiptId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly actor: ResearchActor;
}

interface StateBundle {
  readonly state: ResearchRoomState;
  readonly brief: ResearchBrief;
  readonly briefVersion: ResearchBriefVersion;
  readonly decisions: readonly ResearchDecision[];
  readonly issues: readonly ResearchIssue[];
  readonly allIssues: readonly ResearchIssue[];
  readonly episode?: RevisionEpisode;
  readonly issueHistoryTruncated: boolean;
  readonly receiptHistoryTruncated: boolean;
}

type RoomPageReader<T> = (page: ResearchPageRequest) => ResearchResult<ResearchPage<T>>;

interface PendingReview {
  readonly reviewId: string;
  readonly suggestion: string;
  readonly evidenceClass: ResearchRoomEvidenceClass;
  readonly manifest: ResearchRoomContextManifest;
  readonly manifestHash: string;
  readonly confirmationNonce: string;
  readonly stateBinding: ResearchRoomStateBinding;
  readonly createdAt: string;
  readonly providerInput?: ResearchRoomProviderInput;
  readonly judgeRequest?: ResearchRoomSemanticJudgeRequest;
}

interface AnalyzedEntry extends AnalyzedResearchRoomReview {
  readonly suggestionHash: string;
  readonly evidenceClass: ResearchRoomEvidenceClass;
  readonly createdAt: string;
}

interface InFlightReview {
  readonly confirmationNonce: string;
  readonly manifestHash: string;
  readonly controller: AbortController;
  cancelled: boolean;
}

function hash(value: unknown): CoreResult<string> { return fromDomain(stableResearchHash(value)); }
function isText(value: unknown, maxBytes: number): value is string { return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value.trim(), "utf8") <= maxBytes; }
function nonce(): string { return randomBytes(32).toString("hex"); }
function same(left: unknown, right: unknown): boolean { const a = stableResearchHash(left); const b = stableResearchHash(right); return a.ok && b.ok && a.value === b.value; }

function ledgerOnlyAnalysis(suggestion: string): ResearchRoomAnalysisPayload {
  return Object.freeze({
    schemaVersion: "1.0.0",
    proposal: suggestion.trim(),
    findings: Object.freeze([{ kind: "provider_unavailable" as const, severity: "warning" as const, summary: "No validated semantic Provider result is available; only the local research ledger can be used.", affectedDecisionIds: Object.freeze([]) }]),
    argumentDelta: Object.freeze({ kind: "unproven" as const, summary: "No semantic ArgumentDelta was established.", genuineAdditions: Object.freeze([]) }),
    alternativeExplanations: Object.freeze(["The suggestion may be a useful increment, a target substitution, or a restatement; this remains unclassified."]),
    unknowns: Object.freeze(["The semantic relationship between the suggestion and the current research question is unknown."]),
    minimalCorrection: "Configure an explicit Provider or reject/defer this suggestion without claiming semantic review.",
    unproven: Object.freeze(["Semantic review is unproven in ledger_only mode."]),
  });
}

const ROOM_FINDING_KIND: Readonly<Record<string, ResearchRoomAnalysisPayload["findings"][number]["kind"]>> = Object.freeze({
  focus_substitution: "target_substitution",
  repeated_audit: "repeated_audit",
  audit_hijacking: "repeated_audit",
  semantic_scope_violation: "target_substitution",
  decision_integrity: "evidence_gap",
  argument_leap: "argument_leap",
  evidence_boundary: "evidence_gap",
  shallow_abstraction: "pseudo_depth",
});

function traceFrom(result: ResearchRoomSemanticJudgeResult): ResearchRoomSemanticJudgeTrace {
  return Object.freeze({
    responseHashes: result.responseHashes,
    assessments: result.assessments,
    findings: Object.freeze(result.findings.map((finding) => Object.freeze({
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity === "critical" ? "error" as const : finding.severity,
      rationale: finding.rationale,
      minimumRecovery: finding.minimumRecovery,
      decisionIds: finding.decisionIds,
      issueIds: finding.issueIds,
      authority: "model_proposed" as const,
    }))),
    argumentDelta: result.argumentDelta,
    reasonableIncrement: result.reasonableIncrement,
    derivation: result.derivation,
  });
}

function analysisFrom(suggestion: string, result: ResearchRoomSemanticJudgeResult): ResearchRoomAnalysisPayload {
  const findings: ResearchRoomAnalysisPayload["findings"][number][] = result.findings.map((finding) => Object.freeze({
    kind: ROOM_FINDING_KIND[finding.kind] ?? "evidence_gap",
    severity: finding.severity === "critical" ? "error" as const : finding.severity,
    summary: finding.rationale,
    affectedDecisionIds: finding.decisionIds,
  }));
  if (result.reasonableIncrement.status === "supported") findings.push(Object.freeze({
    kind: "reasonable_increment",
    severity: "info",
    summary: "All required semantic criteria were validated and the suggestion contains a substantive bounded delta.",
    affectedDecisionIds: Object.freeze([]),
  }));
  const unknownAssessments = result.assessments.filter((item) => item.verdict === "unknown");
  const positiveAssessments = result.assessments.filter((item) => item.verdict === "positive" && item.criterionId !== "argument-delta");
  return Object.freeze({
    schemaVersion: "1.0.0",
    proposal: suggestion.trim(),
    findings: Object.freeze(findings),
    argumentDelta: Object.freeze({
      kind: result.argumentDelta.status === "substantive" ? "theoretical_contribution" as const : result.argumentDelta.status === "no_substantive_delta" ? "no_substantive_delta" as const : "unproven" as const,
      summary: result.argumentDelta.summary,
      genuineAdditions: result.argumentDelta.status === "substantive" ? Object.freeze([result.argumentDelta.summary]) : Object.freeze([]),
    }),
    alternativeExplanations: Object.freeze(result.assessments.filter((item) => item.criterionId === "argument-leap" || item.criterionId === "evidence-boundary").map((item) => item.publicRationale)),
    unknowns: Object.freeze(unknownAssessments.flatMap((item) => [item.uncertainty, ...item.missingContext])),
    minimalCorrection: positiveAssessments[0]?.minimalCorrection ?? "No semantic correction is proposed; the user still decides whether to accept the suggestion.",
    unproven: Object.freeze([
      "Provider assessments and semantic finding substance remain model-proposed until the user disposes the review.",
      "No external-user evidence, market demand, adoption, or real second use is established by this review.",
    ]),
  });
}

function providerFailureReason(error: unknown, timedOut: boolean): NonNullable<AnalyzedResearchRoomReview["ledgerOnlyReason"]> {
  if (timedOut) return "provider_timeout";
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "provider_timeout") return "provider_timeout";
    if (code === "provider_configuration_changed") return "provider_configuration_changed";
    if (code === "provider_aborted") return "provider_aborted";
    if (code === "provider_invalid_request" || code === "provider_invalid_response" || code === "provider_response_too_large") return "provider_invalid_response";
  }
  return "provider_failed";
}

export class ResearchRoomService {
  readonly #pending = new Map<string, PendingReview>();
  readonly #inFlight = new Map<string, InFlightReview>();
  readonly #analyzed = new Map<string, AnalyzedEntry>();
  readonly #rollbackConflicts = new Map<string, { readonly projectId: string; readonly receiptId: string; readonly createdAt: string }>();
  constructor(
    private readonly store: ResearchStore,
    private readonly clock: Clock,
    private readonly idFactory: IdFactory,
    private readonly provider: ResearchRoomProvider | undefined,
    private readonly timeoutMs: number,
  ) {}

  getState(projectId: string): CoreResult<ResearchRoomState> {
    const bundle = this.readState(projectId); return bundle.ok ? coreOk(bundle.value.state) : bundle;
  }

  listReceipts(projectId: string): CoreResult<readonly ResearchRoomReceipt[]> {
    const page = fromDomain(this.store.roomReceipts.listByProject(projectId, PAGE));
    if (!page.ok) return page;
    return page.value.nextCursor === undefined ? coreOk(page.value.items) : coreErr("state_conflict");
  }

  getAttentionSignals(projectId: string): readonly TransientAttentionSignal[] {
    const signals: TransientAttentionSignal[] = [];
    const current = this.readState(projectId);
    for (const pending of this.#pending.values()) {
      if (pending.stateBinding.projectId !== projectId) continue;
      const stale = !current.ok || !same(current.value.state.stateBinding, pending.stateBinding);
      signals.push(Object.freeze({
        id: pending.reviewId,
        kind: stale ? "manifest" as const : "review" as const,
        title: stale ? "Stale Context Manifest" : "Prepared Review",
        reason: stale ? "The project state changed after this Manifest was prepared; rebuild it before analysis." : "This prepared Review still awaits explicit confirmation or cancellation.",
        severity: "high" as const,
        href: "/project/review",
        primaryAction: stale ? "Rebuild Context Manifest" : "Confirm analysis or cancel Review",
        sourceObject: Object.freeze({ kind: "review", id: pending.reviewId }),
        createdAt: pending.createdAt,
      }));
    }
    for (const analyzed of this.#analyzed.values()) {
      if (analyzed.stateBinding.projectId !== projectId) continue;
      signals.push(Object.freeze({ id: analyzed.reviewId, kind: "review" as const, title: "Review waiting for disposition", reason: "The analysis exists, but only the user can record its disposition.", severity: "high" as const, href: "/project/review", primaryAction: "Open the Review Authority Gate", sourceObject: Object.freeze({ kind: "review", id: analyzed.reviewId }), createdAt: analyzed.createdAt }));
      if (analyzed.ledgerOnlyReason !== undefined && analyzed.ledgerOnlyReason !== "provider_not_configured" && analyzed.ledgerOnlyReason !== "provider_aborted") signals.push(Object.freeze({ id: `${analyzed.reviewId}-provider`, kind: "provider" as const, title: "Provider result unavailable", reason: `${analyzed.ledgerOnlyReason}; the pending Review is restricted to ledger_only dispositions.`, severity: "high" as const, href: "/project/review", primaryAction: "Reject or defer, or prepare a new Review after recovery", sourceObject: Object.freeze({ kind: "review", id: analyzed.reviewId }), createdAt: analyzed.createdAt }));
    }
    for (const conflict of this.#rollbackConflicts.values()) {
      if (conflict.projectId !== projectId) continue;
      const receipt = this.store.roomReceipts.getById(projectId, conflict.receiptId);
      if (!receipt.ok || receipt.value?.status !== "committed") {
        this.#rollbackConflicts.delete(conflict.receiptId);
        continue;
      }
      if (!receipt.value.rollback.available || !current.ok || same(current.value.state.stateBinding, receipt.value.after)) {
        this.#rollbackConflicts.delete(conflict.receiptId);
        continue;
      }
      signals.push(Object.freeze({ id: conflict.receiptId, kind: "rollback" as const, title: "Rollback conflict", reason: "Newer project state no longer matches this Receipt's post-state; rollback remains stopped without a partial write.", severity: "high" as const, href: `/project/receipts/${conflict.receiptId}`, primaryAction: "Inspect the Receipt and current state", sourceObject: Object.freeze({ kind: "receipt", id: conflict.receiptId }), createdAt: conflict.createdAt }));
    }
    return Object.freeze(signals);
  }

  prepare(input: PrepareResearchRoomReviewInput): CoreResult<PreparedResearchRoomReview> {
    const evidence = parseResearchRoomEvidenceClass(input.evidenceClass);
    if (!evidence.ok || input.countsAsExternalEvidence || !isText(input.suggestion, MAX_SUGGESTION_BYTES)) return coreErr("invalid_input");
    const bundle = this.readState(input.projectId); if (!bundle.ok) return bundle;
    const reviewId = this.idFactory.create("rrvw_");
    const parsedReviewId = /^rrvw_[0-9A-HJKMNP-TV-Z]{26}$/u.test(reviewId); if (!parsedReviewId) return coreErr("infrastructure_failure");
    const bindingHash = hash(bundle.value.state.stateBinding); const suggestionHash = hash(input.suggestion.trim());
    if (!suggestionHash.ok || !bindingHash.ok) return coreErr("infrastructure_failure");
    let judgeRequest: ResearchRoomSemanticJudgeRequest | undefined;
    let providerInput: ResearchRoomProviderInput | undefined;
    if (this.provider !== undefined) {
      const prepared = prepareResearchRoomSemanticJudge({
        reviewId,
        projectId: input.projectId,
        provider: this.provider.binding,
        stateBindingHash: bindingHash.value,
        brief: {
          id: bundle.value.briefVersion.id,
          versionNumber: bundle.value.briefVersion.versionNumber,
          projectQuestion: bundle.value.briefVersion.projectQuestion,
          currentStage: bundle.value.briefVersion.currentStage,
          currentTask: bundle.value.briefVersion.currentTask,
          fixedDecisions: bundle.value.briefVersion.fixedDecisions.map((item) => ({ id: item.id, statement: item.statement })),
          expectedDeltas: bundle.value.briefVersion.expectedDeltas.map((item) => ({ id: item.id, statement: item.statement })),
          evidenceBoundaries: bundle.value.briefVersion.evidenceBoundaries.map((item) => item.statement),
          explicitNonGoals: bundle.value.briefVersion.explicitNonGoals,
        },
        decisions: bundle.value.decisions.map((item) => ({ id: item.id, status: item.status as "accepted" | "frozen", statement: item.statement, rationale: item.rationale, version: item.version })),
        issues: bundle.value.allIssues.map((item) => ({ id: item.id, kind: item.kind, summary: item.summary, status: item.status, version: item.version })),
        receiptSummary: bundle.value.state.receipts.map((item) => ({ id: item.id, disposition: item.disposition.kind, status: item.status, createdAt: item.createdAt })),
        ...(bundle.value.episode ? { currentEpisode: {
          id: bundle.value.episode.id,
          status: bundle.value.episode.status,
          version: bundle.value.episode.version,
          artifactId: bundle.value.episode.artifactId,
          baselineRevisionId: bundle.value.episode.lockedStart.baselineRevisionId,
          ...(bundle.value.episode.candidateRevisionId ? { candidateRevisionId: bundle.value.episode.candidateRevisionId } : {}),
        } } : {}),
        suggestionDocument: { projectId: input.projectId, artifactId: this.idFactory.create("rart_"), revisionId: this.idFactory.create("rrev_"), text: input.suggestion.trim() },
        evidenceClass: evidence.value,
      });
      if (!prepared.ok) return coreErr("infrastructure_failure");
      judgeRequest = prepared.value;
      try { providerInput = this.provider.prepare(judgeRequest); }
      catch { return coreErr("infrastructure_failure"); }
    }
    const context = judgeRequest?.context ?? {
      brief: {
        projectQuestion: bundle.value.briefVersion.projectQuestion,
        currentStage: bundle.value.briefVersion.currentStage,
        currentTask: bundle.value.briefVersion.currentTask,
        fixedDecisions: bundle.value.briefVersion.fixedDecisions,
        expectedDeltas: bundle.value.briefVersion.expectedDeltas,
        evidenceBoundaries: bundle.value.briefVersion.evidenceBoundaries,
        explicitNonGoals: bundle.value.briefVersion.explicitNonGoals,
      },
      decisions: bundle.value.decisions,
      issues: bundle.value.allIssues,
      receiptSummary: bundle.value.state.receipts,
      ...(bundle.value.episode ? { currentEpisode: bundle.value.episode } : {}),
      suggestion: input.suggestion.trim(),
    };
    const contextHash = hash(context);
    if (!contextHash.ok) return coreErr("infrastructure_failure");
    const fields: ResearchRoomContextManifest["fields"] = Object.freeze([
      { category: "research_question", source: "active_research_brief", sensitivity: "research_state", included: true, truncated: false },
      { category: "current_stage", source: "active_research_brief", sensitivity: "research_state", included: true, truncated: false },
      { category: "current_task", source: "active_research_brief", sensitivity: "research_state", included: true, truncated: false },
      { category: "fixed_decisions", source: "active_research_brief", sensitivity: "research_state", included: true, truncated: false },
      { category: "expected_deltas", source: "active_research_brief", sensitivity: "research_state", included: true, truncated: false },
      { category: "evidence_boundaries", source: "active_research_brief", sensitivity: "research_state", included: true, truncated: false },
      { category: "explicit_non_goals", source: "active_research_brief", sensitivity: "research_state", included: true, truncated: false },
      { category: "accepted_decisions", source: "versioned_research_state", sensitivity: "research_state", included: true, truncated: false },
      { category: "issue_history", source: "versioned_research_state", sensitivity: "research_state", included: true, truncated: bundle.value.issueHistoryTruncated },
      { category: "receipt_summary", source: "versioned_research_state", sensitivity: "research_state", included: true, truncated: bundle.value.receiptHistoryTruncated },
      { category: "current_episode", source: "versioned_research_state", sensitivity: "research_state", included: true, truncated: false },
      { category: "single_suggestion", source: "explicit_user_input", sensitivity: "user_supplied_text", included: true, truncated: false },
      { category: "semantic_criteria", source: "versioned_research_state", sensitivity: "research_state", included: true, truncated: false },
    ]);
    const manifest: ResearchRoomContextManifest = Object.freeze({
      schemaVersion: "1.0.0", reviewId, providerId: this.provider?.id ?? "none", providerKind: this.provider?.kind ?? "none",
      networkRequired: this.provider?.networkAccess !== undefined && this.provider.networkAccess !== "none", sendStatus: "not_sent", networkUsed: false,
      fields, contextHash: contextHash.value, suggestionHash: suggestionHash.value, stateBindingHash: bindingHash.value,
      evidenceClass: evidence.value, countsAsExternalEvidence: false,
      ...(judgeRequest && providerInput ? { semanticJudge: {
        protocol: judgeRequest.protocol,
        prompt: judgeRequest.prompt,
        rubric: judgeRequest.rubric,
        provider: judgeRequest.provider,
        request: {
          endpoint: providerInput.endpoint,
          requestHash: providerInput.requestHash,
          requestBody: providerInput.requestBody,
          requestBodyHash: providerInput.requestBodyHash,
          requestBodyBytes: providerInput.requestBodyBytes,
          responseLimitBytes: providerInput.responseLimitBytes,
          redirectPolicy: providerInput.redirectPolicy,
          retryCount: providerInput.retryCount,
        },
        excludedFields: judgeRequest.excludedFields,
      } } : {}),
    });
    const manifestHash = hash(manifest); if (!manifestHash.ok) return manifestHash;
    const confirmationNonce = nonce();
    const createdAtValue = this.clock.now();
    if (!(createdAtValue instanceof Date) || !Number.isFinite(createdAtValue.getTime())) return coreErr("infrastructure_failure");
    this.#pending.set(reviewId, { reviewId, suggestion: input.suggestion.trim(), evidenceClass: evidence.value, manifest, manifestHash: manifestHash.value, confirmationNonce, stateBinding: bundle.value.state.stateBinding, createdAt: createdAtValue.toISOString(), ...(providerInput ? { providerInput } : {}), ...(judgeRequest ? { judgeRequest } : {}) });
    return coreOk(Object.freeze({ reviewId, contextManifestVisible: true, providerStatus: this.provider ? "ready" : "ledger_only", manifest, manifestHash: manifestHash.value, confirmationNonce, stateBinding: bundle.value.state.stateBinding }));
  }

  cancel(input: { readonly reviewId: string; readonly confirmationNonce: string; readonly manifestHash: string }): CoreResult<{ readonly cancelled: true }> {
    const pending = this.#pending.get(input.reviewId);
    if (pending?.confirmationNonce === input.confirmationNonce && pending.manifestHash === input.manifestHash) {
      this.#pending.delete(input.reviewId);
      return coreOk(Object.freeze({ cancelled: true as const }));
    }
    const inFlight = this.#inFlight.get(input.reviewId);
    if (inFlight?.confirmationNonce !== input.confirmationNonce || inFlight.manifestHash !== input.manifestHash) return coreErr("user_confirmation_required");
    inFlight.cancelled = true;
    inFlight.controller.abort();
    return coreOk(Object.freeze({ cancelled: true as const }));
  }

  async analyze(input: { readonly reviewId: string; readonly confirmationNonce: string; readonly manifestHash: string }): Promise<CoreResult<AnalyzedResearchRoomReview>> {
    const pending = this.#pending.get(input.reviewId);
    if (pending?.confirmationNonce !== input.confirmationNonce) return coreErr("user_confirmation_required");
    if (pending.manifestHash !== input.manifestHash) return coreErr("user_confirmation_required");
    const current = this.readState(pending.stateBinding.projectId); if (!current.ok) return current;
    if (!same(current.value.state.stateBinding, pending.stateBinding)) return coreErr("stale_state");
    this.#pending.delete(input.reviewId);
    let providerStatus: "semantic_ready" | "ledger_only" = "ledger_only";
    let ledgerOnlyReason: AnalyzedResearchRoomReview["ledgerOnlyReason"] = "provider_not_configured";
    let analysis = ledgerOnlyAnalysis(pending.suggestion);
      let semanticJudge: ResearchRoomSemanticJudgeTrace | undefined;
      let invoked = false;
      let networkUsed = false;
      if (this.provider !== undefined && pending.judgeRequest !== undefined && pending.providerInput !== undefined) {
        invoked = true; networkUsed = this.provider.networkAccess !== "none";
        const controller = new AbortController();
        const inFlight: InFlightReview = { confirmationNonce: pending.confirmationNonce, manifestHash: pending.manifestHash, controller, cancelled: false };
        this.#inFlight.set(pending.reviewId, inFlight);
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
        try {
          const response = await Promise.race([
            this.provider.analyze(pending.judgeRequest, pending.providerInput, { signal: controller.signal }),
            new Promise<never>((_resolve, reject) => { controller.signal.addEventListener("abort", () => { reject(new Error(inFlight.cancelled ? "operation_cancelled" : "provider_timeout")); }, { once: true }); }),
          ]);
          if (inFlight.cancelled) return coreErr("operation_cancelled");
          const parsed = submitResearchRoomSemanticJudge(pending.judgeRequest, response);
        if (parsed.ok) {
          providerStatus = "semantic_ready";
          ledgerOnlyReason = undefined;
          analysis = analysisFrom(pending.suggestion, parsed.value);
          semanticJudge = traceFrom(parsed.value);
        } else ledgerOnlyReason = "provider_invalid_response";
        } catch (error) {
          if (inFlight.cancelled) return coreErr("operation_cancelled");
          ledgerOnlyReason = providerFailureReason(error, timedOut);
        } finally {
          clearTimeout(timer);
          this.#inFlight.delete(pending.reviewId);
        }
      }
    const manifest: ResearchRoomContextManifest = Object.freeze({ ...pending.manifest, sendStatus: invoked ? "sent_to_provider" : "not_sent", networkUsed });
    const entry: AnalyzedEntry = Object.freeze({ reviewId: pending.reviewId, providerStatus, ...(ledgerOnlyReason ? { ledgerOnlyReason } : {}), manifest, analysis, ...(semanticJudge ? { semanticJudge } : {}), authorityNonce: nonce(), stateBinding: pending.stateBinding, suggestionHash: pending.manifest.suggestionHash, evidenceClass: pending.evidenceClass, createdAt: pending.createdAt });
    this.#analyzed.set(entry.reviewId, entry);
    return coreOk(entry);
  }

  commit(input: CommitResearchRoomDispositionInput): CoreResult<ResearchRoomReceipt> {
    const actor = validateResearchActor(input.actor); if (!actor.ok || actor.value.kind !== "user") return coreErr("user_confirmation_required");
    const analyzed = this.#analyzed.get(input.reviewId);
    if (analyzed?.authorityNonce !== input.authorityNonce) return coreErr("user_confirmation_required");
    if (analyzed.stateBinding.projectId !== input.projectId) return coreErr("user_confirmation_required");
    const expected = parseResearchRoomStateBinding(input.expectedStateBinding); if (!expected.ok || !same(expected.value, analyzed.stateBinding)) return coreErr("stale_state");
    if (!["accepted", "rejected", "modified_accepted", "deferred", "direction_changed"].includes(input.disposition) || !isText(input.reason, 4_096)) return coreErr("invalid_input");
    if (analyzed.providerStatus === "ledger_only" && !["rejected", "deferred"].includes(input.disposition)) return coreErr("review_blocked");
    if (input.disposition === "modified_accepted" && !isText(input.modifiedProposal, MAX_SUGGESTION_BYTES)) return coreErr("invalid_input");
    const redirectQuestion = input.redirectQuestion;
    if (input.disposition === "direction_changed" && !isText(redirectQuestion, 4_096)) return coreErr("invalid_input");
    const current = this.readState(input.projectId); if (!current.ok) return current;
    if (!same(current.value.state.stateBinding, analyzed.stateBinding)) return coreErr("stale_state");

    const result = this.store.unitOfWork.commit(() => {
      let afterBundle = current.value;
      if (input.disposition === "direction_changed") {
        const now = this.clock.now(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { ok: false, error: { code: "invalid_timestamp", message: "Invalid timestamp" } };
        const source = parseResearchSource({ actor: actor.value, authority: "user_recorded", recordedAt: now.toISOString() }); if (!source.ok) return source;
        if (redirectQuestion === undefined) return { ok: false, error: { code: "invalid_research_room_review", message: "Redirect question is missing" } };
        const proposed = createBriefChangeProposal(current.value.brief, { changes: { projectQuestion: redirectQuestion }, reason: input.reason.trim(), source: source.value }, { clock: this.clock, idFactory: this.idFactory }); if (!proposed.ok) return proposed;
        const confirmed = confirmBriefChangeProposal(proposed.value.brief, proposed.value.proposal.id, actor.value, proposed.value.brief.version, { clock: this.clock, idFactory: this.idFactory }); if (!confirmed.ok) return confirmed;
        const storedProposal = this.store.briefs.compareAndSwap(proposed.value.brief, current.value.brief.version); if (!storedProposal.ok) return storedProposal;
        const storedBrief = this.store.briefs.compareAndSwap(confirmed.value, proposed.value.brief.version); if (!storedBrief.ok) return storedBrief;
        const refreshed = this.readState(input.projectId); if (!refreshed.ok) return { ok: false, error: { code: refreshed.error.code === "stale_state" ? "version_conflict" : "research_storage_unavailable", message: refreshed.error.message } };
        afterBundle = refreshed.value;
      }
      const disposition = {
        kind: input.disposition, reason: input.reason.trim(),
        ...(input.modifiedProposal ? { modifiedProposal: input.modifiedProposal.trim() } : {}),
        ...(input.redirectQuestion ? { redirectQuestion: input.redirectQuestion.trim() } : {}),
      };
      const receipt = createResearchRoomReceipt({
        projectId: input.projectId, reviewId: analyzed.reviewId,
        ...(current.value.episode ? { sourceEpisodeId: current.value.episode.id } : {}),
        providerStatus: analyzed.providerStatus, ...(analyzed.ledgerOnlyReason ? { ledgerOnlyReason: analyzed.ledgerOnlyReason } : {}),
        evidenceClass: analyzed.evidenceClass, countsAsExternalEvidence: false, suggestionHash: analyzed.suggestionHash,
        manifest: analyzed.manifest, analysis: analyzed.analysis, disposition,
        ...(analyzed.semanticJudge ? { semanticJudge: analyzed.semanticJudge } : {}),
        before: current.value.state.stateBinding, after: afterBundle.state.stateBinding,
        rollback: { available: true, ...(input.disposition === "direction_changed" ? { priorQuestion: current.value.briefVersion.projectQuestion } : {}) },
        actor: actor.value,
      }, { clock: this.clock, idFactory: this.idFactory });
      return receipt.ok ? this.store.roomReceipts.create(receipt.value) : receipt;
    });
    const mapped = fromDomain(result);
    if (mapped.ok) this.#analyzed.delete(input.reviewId);
    return mapped;
  }

  rollback(input: RollbackResearchRoomReceiptInput): CoreResult<ResearchRoomReceipt> {
    const actor = validateResearchActor(input.actor); if (!actor.ok || actor.value.kind !== "user") return coreErr("user_confirmation_required");
    const expectedVersion = parseEntityVersion(input.expectedVersion);
    if (!isText(input.reason, 4_096) || !expectedVersion.ok) return coreErr("invalid_input");
    const located = fromDomain(this.store.roomReceipts.getById(input.projectId, input.receiptId)); if (!located.ok) return located;
    if (located.value === undefined) return coreErr("not_found"); const receipt = located.value;
    if (receipt.version !== input.expectedVersion) return coreErr("stale_state");
    const current = this.readState(input.projectId); if (!current.ok) return current;
    if (!same(current.value.state.stateBinding, receipt.after)) {
      const at = this.clock.now();
      if (at instanceof Date && Number.isFinite(at.getTime())) this.#rollbackConflicts.set(receipt.id, Object.freeze({ projectId: input.projectId, receiptId: receipt.id, createdAt: at.toISOString() }));
      return coreErr("stale_state");
    }
    const result = this.store.unitOfWork.commit(() => {
      let restored = current.value; let rollbackBriefVersionId: string | undefined;
      if (receipt.disposition.kind === "direction_changed") {
        if (!isText(receipt.rollback.priorQuestion, 4_096) || current.value.briefVersion.id !== receipt.after.briefVersionId) return { ok: false, error: { code: "version_conflict", message: "Version conflict" } };
        const now = this.clock.now(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { ok: false, error: { code: "invalid_timestamp", message: "Invalid timestamp" } };
        const source = parseResearchSource({ actor: actor.value, authority: "user_recorded", recordedAt: now.toISOString() }); if (!source.ok) return source;
        const proposed = createBriefChangeProposal(current.value.brief, { changes: { projectQuestion: receipt.rollback.priorQuestion }, reason: input.reason.trim(), source: source.value }, { clock: this.clock, idFactory: this.idFactory }); if (!proposed.ok) return proposed;
        const confirmed = confirmBriefChangeProposal(proposed.value.brief, proposed.value.proposal.id, actor.value, proposed.value.brief.version, { clock: this.clock, idFactory: this.idFactory }); if (!confirmed.ok) return confirmed;
        const storedProposal = this.store.briefs.compareAndSwap(proposed.value.brief, current.value.brief.version); if (!storedProposal.ok) return storedProposal;
        const storedBrief = this.store.briefs.compareAndSwap(confirmed.value, proposed.value.brief.version); if (!storedBrief.ok) return storedBrief;
        const active = getActiveResearchBriefVersion(storedBrief.value); if (active === undefined) return { ok: false, error: { code: "invalid_research_brief", message: "Invalid brief" } };
        rollbackBriefVersionId = active.id;
        const refreshed = this.readState(input.projectId); if (!refreshed.ok) return { ok: false, error: { code: "research_storage_unavailable", message: refreshed.error.message } };
        restored = refreshed.value;
        if (restored.state.stateBinding.stateHash !== receipt.before.stateHash) return { ok: false, error: { code: "invalid_research_room_transition", message: "Rollback state mismatch" } };
      }
      const rolled = rollBackResearchRoomReceipt(receipt, { actor: actor.value, expectedVersion: expectedVersion.value, reason: input.reason.trim(), restoredStateHash: restored.state.stateBinding.stateHash, ...(rollbackBriefVersionId ? { rollbackBriefVersionId } : {}) }, this.clock);
      return rolled.ok ? this.store.roomReceipts.compareAndSwap(rolled.value, expectedVersion.value) : rolled;
    });
    const mapped = fromDomain(result);
    if (mapped.ok) this.#rollbackConflicts.delete(receipt.id);
    return mapped;
  }

  private forEachPaged<T>(reader: RoomPageReader<T>, visit: (item: T) => void): CoreResult<void> {
    let cursor: string | undefined;
    do {
      const page = fromDomain(reader({ limit: PAGE.limit, ...(cursor ? { cursor } : {}) }));
      if (!page.ok) return page;
      for (const item of page.value.items) visit(item);
      cursor = page.value.nextCursor;
    } while (cursor !== undefined);
    return coreOk(undefined);
  }

  private readState(projectId: string): CoreResult<StateBundle> {
    const project = fromDomain(this.store.projects.getById(projectId)); if (!project.ok) return project; if (project.value === undefined) return coreErr("not_found");
    let active: { readonly brief: ResearchBrief; readonly version: ResearchBriefVersion } | undefined;
    const briefs = this.forEachPaged(this.store.briefs.listByProject.bind(this.store.briefs, projectId), (brief) => {
      const version = getActiveResearchBriefVersion(brief); if (version === undefined) return;
      if (active === undefined || version.createdAt > active.version.createdAt || (version.createdAt === active.version.createdAt && version.id > active.version.id)) active = { brief, version };
    });
    if (!briefs.ok) return briefs;
    if (active === undefined) return coreErr("state_conflict");

    const decisions: (ResearchDecision & { readonly status: "accepted" | "frozen" })[] = [];
    let activeDecisionCount = 0;
    const decisionScan = this.forEachPaged(this.store.decisions.listByScope.bind(this.store.decisions, projectId, undefined), (item) => {
      if (item.status !== "accepted" && item.status !== "frozen") return;
      activeDecisionCount += 1;
      if (decisions.length < PAGE.limit) decisions.push(item as ResearchDecision & { readonly status: "accepted" | "frozen" });
    });
    if (!decisionScan.ok) return decisionScan;
    if (activeDecisionCount > decisions.length) return coreErr("state_conflict");
    decisions.sort((a, b) => a.id.localeCompare(b.id));

    const issues: ResearchIssue[] = [];
    const recentIssues: ResearchIssue[] = [];
    let unresolvedIssueCount = 0;
    let issueCount = 0;
    const issueScan = this.forEachPaged(this.store.issues.listByStatus.bind(this.store.issues, projectId, undefined), (item) => {
      issueCount += 1;
      recentIssues.push(item);
      recentIssues.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
      if (recentIssues.length > PAGE.limit) recentIssues.length = PAGE.limit;
      if (["resolved", "suppressed", "waived"].includes(item.status)) return;
      unresolvedIssueCount += 1;
      if (issues.length < PAGE.limit) issues.push(item);
    });
    if (!issueScan.ok) return issueScan;
    if (unresolvedIssueCount > issues.length) return coreErr("state_conflict");
    issues.sort((a, b) => a.id.localeCompare(b.id));
    const allIssues = [...new Map([...issues, ...recentIssues].map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, PAGE.limit);

    let episode: RevisionEpisode | undefined;
    const episodeScan = this.forEachPaged(this.store.episodes.listByProject.bind(this.store.episodes, projectId), (item) => {
      if (episode === undefined || item.createdAt > episode.createdAt || (item.createdAt === episode.createdAt && item.id > episode.id)) episode = item;
    });
    if (!episodeScan.ok) return episodeScan;

    const receipts: ResearchRoomReceipt[] = [];
    let receiptCount = 0;
    const receiptScan = this.forEachPaged(this.store.roomReceipts.listByProject.bind(this.store.roomReceipts, projectId), (item) => {
      receiptCount += 1;
      receipts.push(item);
      if (receipts.length > PAGE.limit) receipts.shift();
    });
    if (!receiptScan.ok) return receiptScan;
    const semantic = {
      projectId,
      brief: { projectQuestion: active.version.projectQuestion, currentStage: active.version.currentStage, currentTask: active.version.currentTask, fixedDecisions: active.version.fixedDecisions, expectedDeltas: active.version.expectedDeltas, evidenceBoundaries: active.version.evidenceBoundaries, explicitNonGoals: active.version.explicitNonGoals },
      decisions: decisions.map((item) => ({ id: item.id, statement: item.statement, rationale: item.rationale, status: item.status })),
      issues: issues.map((item) => ({ id: item.id, kind: item.kind, summary: item.summary, status: item.status })),
      ...(episode ? { episode: { id: episode.id, status: episode.status, lockedStartHash: episode.lockedStartHash } } : {}),
    };
    const stateHash = hash(semantic); if (!stateHash.ok) return stateHash;
    const stateBinding: ResearchRoomStateBinding = Object.freeze({ projectId, stateHash: stateHash.value, briefVersionId: active.version.id, briefVersionNumber: active.version.versionNumber, ...(episode ? { currentEpisodeId: episode.id, currentEpisodeVersion: episode.version } : {}), decisions: Object.freeze(decisions.map((item) => ({ id: item.id, version: item.version, status: item.status }))), issues: Object.freeze(issues.map((item) => ({ id: item.id, version: item.version, status: item.status }))) });
    const state: ResearchRoomState = Object.freeze({
      project: Object.freeze({ id: project.value.id, title: project.value.title }),
      brief: Object.freeze({ id: active.brief.id, versionId: active.version.id, versionNumber: active.version.versionNumber, projectQuestion: active.version.projectQuestion, currentStage: active.version.currentStage, currentTask: active.version.currentTask, fixedDecisions: Object.freeze(active.version.fixedDecisions.map((item) => ({ id: item.id, statement: item.statement }))), expectedDeltas: Object.freeze(active.version.expectedDeltas.map((item) => ({ id: item.id, statement: item.statement }))), explicitNonGoals: active.version.explicitNonGoals }),
      decisions: Object.freeze(decisions.map((item) => ({ id: item.id, statement: item.statement, rationale: item.rationale, status: item.status, version: item.version }))),
      issues: Object.freeze(issues.map((item) => ({ id: item.id, kind: item.kind, summary: item.summary, status: item.status, version: item.version }))),
      ...(episode ? { currentEpisode: Object.freeze({ id: episode.id, status: episode.status, version: episode.version, artifactId: episode.artifactId, createdAt: episode.createdAt }) } : {}),
      stateBinding, receipts: Object.freeze(receipts),
    });
    return coreOk({ state, brief: active.brief, briefVersion: active.version, decisions, issues, allIssues, ...(episode ? { episode } : {}), issueHistoryTruncated: issueCount > allIssues.length, receiptHistoryTruncated: receiptCount > receipts.length });
  }
}
