import { createHash } from "node:crypto";
import {
  cancelCorrectionAppealSecondOpinion,
  completeCorrectionAppealSecondOpinion,
  createCorrectionAppeal,
  deriveAppealComparison,
  failCorrectionAppealSecondOpinion,
  markCorrectionAppealRecordOnly,
  markCorrectionAppealStale,
  parseResearchIdFor,
  prepareCorrectionAppealSecondOpinion,
  recordCorrectionAppeal,
  resolveCorrectionAppeal,
  stableResearchHash,
  startCorrectionAppealSecondOpinion,
  updateCorrectionAppealStatement,
  validateResearchActor,
  type AppealIndependenceBasis,
  type AppealResolutionKind,
  type AppealSourceBinding,
  type AppealStatement,
  type Clock,
  type CorrectionAppeal,
  type EntityVersion,
  type IdFactory,
  type ResearchActor,
  type ResearchRoomReceipt,
  type SecondOpinionFailure,
  type SecondOpinionManifest,
  type SecondOpinionParticipantSnapshot,
} from "@sestina/research";
import type { ResearchStore } from "@sestina/research-store";
import {
  getResearchRoomSemanticCriterionDefinition,
  prepareCorrectionAppealSecondOpinionRequest,
  submitCorrectionAppealSecondOpinion,
  type CorrectionAppealAllowedContextObject,
  type CorrectionAppealSecondOpinionRequest,
  type ResearchRoomSemanticProviderBinding,
} from "@sestina/review";
import { coreErr, coreOk, fromDomain, type CoreResult } from "./errors.js";
import type { ResearchRoomState } from "./research-room.js";

const PAGE = Object.freeze({ limit: 200 });
const MAX_PROVIDER_TIMEOUT_MS = 120_000;

export interface CorrectionAppealSecondOpinionProviderInput {
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

export interface CorrectionAppealSecondOpinionProvider {
  readonly id: string;
  readonly connectionId: string;
  readonly kind: "deterministic_fixture" | "local" | "external";
  readonly networkAccess: "none" | "loopback" | "external";
  readonly endpointIdentityHash: string;
  readonly binding: ResearchRoomSemanticProviderBinding;
  prepare(request: CorrectionAppealSecondOpinionRequest): CorrectionAppealSecondOpinionProviderInput;
  analyze(request: CorrectionAppealSecondOpinionRequest, preview: CorrectionAppealSecondOpinionProviderInput, options: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface CreateCorrectionAppealInput {
  readonly projectId: string;
  readonly receiptId: string;
  readonly findingId: string;
  readonly statement: AppealStatement;
  readonly actor: ResearchActor;
}

export interface UpdateCorrectionAppealInput {
  readonly projectId: string;
  readonly appealId: string;
  readonly expectedVersion: EntityVersion;
  readonly statement: AppealStatement;
  readonly actor: ResearchActor;
}

export interface CorrectionAppealCommandInput {
  readonly projectId: string;
  readonly appealId: string;
  readonly expectedVersion: EntityVersion;
  readonly actor: ResearchActor;
}

export interface CorrectionAppealAllowedContextSelection {
  readonly includeBrief: boolean;
  readonly decisionIds: readonly string[];
  readonly issueIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface PrepareCorrectionAppealSecondOpinionCoreInput extends CorrectionAppealCommandInput {
  readonly allowedContext: CorrectionAppealAllowedContextSelection;
}

export interface PreparedCorrectionAppealSecondOpinion {
  readonly contextManifestVisible: true;
  readonly appeal: CorrectionAppeal;
  readonly attemptId: string;
  readonly confirmationNonce: string;
  readonly manifest: SecondOpinionManifest;
  readonly request: CorrectionAppealSecondOpinionRequest;
  readonly providerPreview: {
    readonly endpoint: string;
    readonly requestBodyBytes: number;
    readonly responseLimitBytes: number;
    readonly retryCount: 0;
    readonly redirectPolicy: "error";
  };
}

export interface RunCorrectionAppealSecondOpinionInput extends CorrectionAppealCommandInput {
  readonly attemptId: string;
  readonly confirmationNonce: string;
  readonly manifestHash: string;
}

export interface CancelCorrectionAppealSecondOpinionInput extends CorrectionAppealCommandInput {
  readonly attemptId: string;
}

export interface ResolveCorrectionAppealInput extends CorrectionAppealCommandInput {
  readonly kind: AppealResolutionKind;
  readonly publicReason: string;
}

interface ActiveCall {
  readonly controller: AbortController;
  readonly promise: Promise<CoreResult<CorrectionAppeal>>;
}

const FINDING_KIND_TO_CRITERION: Readonly<Record<string, string>> = Object.freeze({
  focus_substitution: "focus-substitution",
  repeated_audit: "repeated-audit",
  audit_hijacking: "audit-hijacking",
  semantic_scope_violation: "semantic-scope",
  decision_integrity: "decision-integrity",
  argument_leap: "argument-leap",
  evidence_boundary: "evidence-boundary",
  shallow_abstraction: "shallow-abstraction",
});

function userActor(actor: ResearchActor): actor is ResearchActor & { readonly kind: "user" } {
  const parsed = validateResearchActor(actor);
  return parsed.ok && parsed.value.kind === "user";
}

function same(left: unknown, right: unknown): boolean {
  const a = stableResearchHash(left);
  const b = stableResearchHash(right);
  return a.ok && b.ok && a.value === b.value;
}

function rawSha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createCorrectionAppealProviderEndpointIdentityHash(binding: ResearchRoomSemanticProviderBinding): string | undefined {
  const result = stableResearchHash({ family: binding.family, model: binding.model, baseUrlOrigin: binding.baseUrlOrigin });
  return result.ok ? result.value : undefined;
}

function validateProviderPreview(request: CorrectionAppealSecondOpinionRequest, preview: CorrectionAppealSecondOpinionProviderInput): boolean {
  const schemaVersion: unknown = preview.schemaVersion;
  const redirectPolicy: unknown = preview.redirectPolicy;
  const retryCount: unknown = preview.retryCount;
  if (schemaVersion !== "1.0.0" || preview.requestHash !== request.requestHash || preview.requestBodyHash !== rawSha(preview.requestBody) || preview.requestBodyBytes !== Buffer.byteLength(preview.requestBody, "utf8") || preview.responseLimitBytes !== request.limits.maxResponseBytes || redirectPolicy !== "error" || retryCount !== 0 || !same(preview.provider, request.provider)) return false;
  try {
    const endpoint = new URL(preview.endpoint);
    return endpoint.username === "" && endpoint.password === "" && endpoint.protocol === new URL(request.provider.baseUrlOrigin).protocol && endpoint.origin === request.provider.baseUrlOrigin;
  } catch {
    return false;
  }
}

function normalizedFailure(error: unknown, timedOut: boolean): SecondOpinionFailure {
  if (timedOut) return "provider_timeout";
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "provider_timeout") return "provider_timeout";
    if (code === "provider_offline") return "provider_offline";
    if (code === "provider_configuration_changed") return "provider_configuration_changed";
  }
  return "provider_failed";
}

function uniqueStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const items: readonly unknown[] = value;
  if (!items.every((item): item is string => typeof item === "string")) return undefined;
  if (new Set(items).size !== items.length) return undefined;
  return Object.freeze(items.slice());
}

export class CorrectionAppealService {
  readonly #activeCalls = new Map<string, ActiveCall>();

  constructor(
    private readonly store: ResearchStore,
    private readonly clock: Clock,
    private readonly idFactory: IdFactory,
    private readonly readResearchRoomState: (projectId: string) => CoreResult<ResearchRoomState>,
    private readonly provider?: CorrectionAppealSecondOpinionProvider,
    private readonly timeoutMs = 15_000,
  ) {}

  get(projectId: string, appealId: string): CoreResult<CorrectionAppeal | undefined> {
    if (!parseResearchIdFor(projectId, "rprj_").ok || !parseResearchIdFor(appealId, "rapl_").ok) return coreErr("invalid_input");
    return fromDomain(this.store.correctionAppeals.getById(projectId, appealId));
  }

  list(projectId: string): CoreResult<readonly CorrectionAppeal[]> {
    if (!parseResearchIdFor(projectId, "rprj_").ok) return coreErr("invalid_input");
    const values: CorrectionAppeal[] = [];
    let cursor: string | undefined;
    do {
      const page = fromDomain(this.store.correctionAppeals.listByProject(projectId, { ...PAGE, ...(cursor ? { cursor } : {}) }));
      if (!page.ok) return page;
      values.push(...page.value.items);
      cursor = page.value.nextCursor;
    } while (cursor !== undefined);
    values.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    return coreOk(Object.freeze(values));
  }

  create(input: CreateCorrectionAppealInput): CoreResult<CorrectionAppeal> {
    if (!userActor(input.actor) || !parseResearchIdFor(input.projectId, "rprj_").ok || !parseResearchIdFor(input.receiptId, "rrcp_").ok || !parseResearchIdFor(input.findingId, "rfnd_").ok) return coreErr(userActor(input.actor) ? "invalid_input" : "user_confirmation_required");
    const receiptResult = fromDomain(this.store.roomReceipts.getById(input.projectId, input.receiptId));
    if (!receiptResult.ok) return receiptResult;
    if (receiptResult.value === undefined) return coreErr("not_found");
    const receipt = receiptResult.value;
    const existingResult = fromDomain(this.store.correctionAppeals.getActiveBySource(input.projectId, receipt.reviewId, input.findingId));
    if (!existingResult.ok) return existingResult;
    if (existingResult.value !== undefined) {
      const latest = existingResult.value.statements.at(-1)?.statement;
      return latest !== undefined && same(latest, input.statement) ? coreOk(existingResult.value) : coreErr("state_conflict");
    }
    const source = this.sourceFromReceipt(receipt, input.findingId);
    if (!source.ok) return source;
    const prior = this.latestResolvedForSource(input.projectId, receipt.reviewId, input.findingId);
    if (!prior.ok) return prior;
    const created = fromDomain(createCorrectionAppeal({ source: source.value, statement: input.statement, actor: input.actor, ...(prior.value ? { previousAppealId: prior.value.id, rootAppealId: prior.value.lineage.rootAppealId } : {}) }, { clock: this.clock, idFactory: this.idFactory }));
    return created.ok ? fromDomain(this.store.correctionAppeals.create(created.value)) : created;
  }

  update(input: UpdateCorrectionAppealInput): CoreResult<CorrectionAppeal> {
    if (!userActor(input.actor)) return coreErr("user_confirmation_required");
    const current = this.require(input.projectId, input.appealId); if (!current.ok) return current;
    if (same(current.value.statements.at(-1)?.statement, input.statement)) return coreOk(current.value);
    const next = fromDomain(updateCorrectionAppealStatement(current.value, { statement: input.statement, actor: input.actor, expectedVersion: input.expectedVersion }, this.clock));
    return next.ok ? fromDomain(this.store.correctionAppeals.compareAndSwap(next.value, current.value.version)) : next;
  }

  record(input: CorrectionAppealCommandInput): CoreResult<CorrectionAppeal> {
    if (!userActor(input.actor)) return coreErr("user_confirmation_required");
    const current = this.require(input.projectId, input.appealId); if (!current.ok) return current;
    if (current.value.status !== "draft") {
      if (current.value.status === "recorded" && this.provider === undefined) return this.markRecordOnly(input);
      return coreOk(current.value);
    }
    const result = this.store.unitOfWork.commit((repositories) => {
      const recorded = recordCorrectionAppeal(current.value, { actor: input.actor, expectedVersion: input.expectedVersion }, this.clock);
      if (!recorded.ok) return recorded;
      const stored = repositories.correctionAppeals.compareAndSwap(recorded.value, current.value.version);
      if (!stored.ok || this.provider !== undefined) return stored;
      const recordOnly = markCorrectionAppealRecordOnly(stored.value, { expectedVersion: stored.value.version }, this.clock);
      return recordOnly.ok ? repositories.correctionAppeals.compareAndSwap(recordOnly.value, stored.value.version) : recordOnly;
    });
    return fromDomain(result);
  }

  markRecordOnly(input: CorrectionAppealCommandInput): CoreResult<CorrectionAppeal> {
    if (!userActor(input.actor)) return coreErr("user_confirmation_required");
    const current = this.require(input.projectId, input.appealId); if (!current.ok) return current;
    if (current.value.status === "appeal_record_only") return coreOk(current.value);
    const next = fromDomain(markCorrectionAppealRecordOnly(current.value, { expectedVersion: input.expectedVersion }, this.clock));
    return next.ok ? fromDomain(this.store.correctionAppeals.compareAndSwap(next.value, current.value.version)) : next;
  }

  prepare(input: PrepareCorrectionAppealSecondOpinionCoreInput): CoreResult<PreparedCorrectionAppealSecondOpinion> {
    if (!userActor(input.actor)) return coreErr("user_confirmation_required");
    if (this.provider === undefined) return coreErr("review_blocked");
    const providerCheck = this.validProvider(this.provider); if (!providerCheck) return coreErr("review_blocked");
    const current = this.require(input.projectId, input.appealId); if (!current.ok) return current;
    const state = this.readResearchRoomState(input.projectId); if (!state.ok) return state;
    const bindingHash = stableResearchHash(state.value.stateBinding);
    if (!bindingHash.ok) return coreErr("infrastructure_failure");
    if (bindingHash.value !== current.value.source.createdStateBindingHash) return this.persistStale(current.value, "research_state_changed_since_appeal_creation");
    const objects = this.allowedObjects(state.value, input.allowedContext); if (!objects.ok) return objects;

    const latest = current.value.attempts.at(-1);
    if (current.value.status === "awaiting_send_confirmation" && latest?.status === "prepared") {
      if (!same(latest.manifest.includedObjects, objects.value)) return coreErr("stale_state");
      return this.preparedProjection(current.value, latest.id);
    }

    const receipt = this.boundReceipt(current.value); if (!receipt.ok) return receipt;
    if (receipt.value.manifest.semanticJudge?.rubric.hash !== current.value.source.rubric.sourceRubricHash || receipt.value.manifest.semanticJudge.rubric.version !== current.value.source.rubric.version) return coreErr("review_blocked");
    const currentCriterion = getResearchRoomSemanticCriterionDefinition(current.value.source.rubric.criterionId);
    if (currentCriterion?.hash !== current.value.source.rubric.hash || currentCriterion.sourceRubricHash !== current.value.source.rubric.sourceRubricHash) return coreErr("review_blocked");
    const originalBinding = receipt.value.manifest.semanticJudge.provider;
    const originalIdentityHash = createCorrectionAppealProviderEndpointIdentityHash(originalBinding);
    if (originalIdentityHash === undefined || this.provider.connectionId === originalBinding.id || this.provider.endpointIdentityHash === originalIdentityHash) return coreErr("review_blocked");

    const attemptId = this.idFactory.create("rsop_");
    if (!parseResearchIdFor(attemptId, "rsop_").ok) return coreErr("infrastructure_failure");
    const request = this.requestFor(current.value, receipt.value, attemptId, objects.value); if (!request.ok) return request;
    let preview: CorrectionAppealSecondOpinionProviderInput;
    try { preview = this.provider.prepare(request.value); } catch { return coreErr("review_blocked"); }
    if (!validateProviderPreview(request.value, preview)) return coreErr("review_blocked");

    const participant: SecondOpinionParticipantSnapshot = Object.freeze({ connectionId: this.provider.connectionId, providerId: this.provider.id, family: this.provider.binding.family, model: this.provider.binding.model, endpointIdentityHash: this.provider.endpointIdentityHash, configGeneration: this.provider.binding.configGeneration, locality: this.provider.binding.locality });
    const independenceBasis: AppealIndependenceBasis = Object.freeze({ status: "runtime_and_context_isolated", originalConnectionId: originalBinding.id, secondConnectionId: this.provider.connectionId, identityComparison: "different_runtime_identity", contextIsolation: "original_verdict_reason_confidence_and_raw_response_excluded" });
    const manifestWithoutCanonical = {
      schemaVersion: "1.0.0" as const,
      requestHash: request.value.requestHash,
      requestBodyHash: preview.requestBodyHash,
      requestBodyBytes: preview.requestBodyBytes,
      includedFields: Object.freeze(["frozen_input", "criterion_rubric", "user_second_opinion_question", ...objects.value.map((item) => `${item.kind}:${item.id}`)]),
      includedObjects: objects.value,
      excludedFields: request.value.excludedFields,
      tokenEstimate: Object.freeze({ status: "unavailable" as const }),
      costEstimate: Object.freeze({ status: "unavailable" as const }),
      stateBindingHash: current.value.source.createdStateBindingHash,
    };
    const canonical = stableResearchHash(manifestWithoutCanonical); if (!canonical.ok) return coreErr("infrastructure_failure");
    const manifest: SecondOpinionManifest = Object.freeze({ ...manifestWithoutCanonical, canonicalHash: canonical.value });
    const prepared = fromDomain(prepareCorrectionAppealSecondOpinion(current.value, { actor: input.actor, expectedVersion: input.expectedVersion, attemptId, participant, independenceBasis, manifest }, { clock: this.clock, idFactory: this.idFactory }));
    if (!prepared.ok) return prepared;
    const stored = fromDomain(this.store.correctionAppeals.compareAndSwap(prepared.value, current.value.version));
    return stored.ok ? this.preparedProjection(stored.value, attemptId) : stored;
  }

  async run(input: RunCorrectionAppealSecondOpinionInput): Promise<CoreResult<CorrectionAppeal>> {
    if (!userActor(input.actor)) return coreErr("user_confirmation_required");
    const active = this.#activeCalls.get(input.attemptId);
    if (active !== undefined) return active.promise;
    const loaded = this.require(input.projectId, input.appealId); if (!loaded.ok) return loaded;
    const last = loaded.value.attempts.at(-1);
    if (last?.id !== input.attemptId) return coreErr("not_found");
    if (last.status === "completed") return coreOk(loaded.value);
    if (last.status === "failed" || last.status === "unknown") return coreOk(loaded.value);
    if (last.status === "cancelled") return coreErr("operation_cancelled");
    if (last.status === "running") return this.failInterrupted(loaded.value, last.id);
    if (this.provider === undefined || !this.validProvider(this.provider)) return this.startThenFail(loaded.value, input, "provider_configuration_changed");

    const reconstructed = this.reconstruct(loaded.value, last.id); if (!reconstructed.ok) return this.startThenFail(loaded.value, input, "provider_configuration_changed");
    const preview = reconstructed.value.preview;
    if (preview.requestBodyHash !== last.manifest.requestBodyHash || preview.requestBodyBytes !== last.manifest.requestBodyBytes || reconstructed.value.request.requestHash !== last.manifest.requestHash) return this.startThenFail(loaded.value, input, "provider_configuration_changed");
    const started = fromDomain(startCorrectionAppealSecondOpinion(loaded.value, { actor: input.actor, expectedVersion: input.expectedVersion, attemptId: input.attemptId, confirmationNonce: input.confirmationNonce, manifestHash: input.manifestHash }, this.clock));
    if (!started.ok) return started;
    const stored = fromDomain(this.store.correctionAppeals.compareAndSwap(started.value, loaded.value.version));
    if (!stored.ok) return stored;

    const controller = new AbortController();
    const promise = this.invokeProvider(stored.value, reconstructed.value.request, preview, controller);
    this.#activeCalls.set(input.attemptId, { controller, promise });
    try { return await promise; } finally { this.#activeCalls.delete(input.attemptId); }
  }

  cancel(input: CancelCorrectionAppealSecondOpinionInput): CoreResult<CorrectionAppeal> {
    if (!userActor(input.actor)) return coreErr("user_confirmation_required");
    const current = this.require(input.projectId, input.appealId); if (!current.ok) return current;
    const last = current.value.attempts.at(-1);
    if (last?.id !== input.attemptId) return coreErr("not_found");
    if (last.status === "cancelled") return coreOk(current.value);
    const cancelled = fromDomain(cancelCorrectionAppealSecondOpinion(current.value, { actor: input.actor, expectedVersion: input.expectedVersion, attemptId: input.attemptId }, this.clock));
    if (!cancelled.ok) return cancelled;
    const stored = fromDomain(this.store.correctionAppeals.compareAndSwap(cancelled.value, current.value.version));
    if (stored.ok) this.#activeCalls.get(input.attemptId)?.controller.abort();
    return stored;
  }

  resolve(input: ResolveCorrectionAppealInput): CoreResult<CorrectionAppeal> {
    if (!userActor(input.actor)) return coreErr("user_confirmation_required");
    const current = this.require(input.projectId, input.appealId); if (!current.ok) return current;
    const last = current.value.resolutions.at(-1);
    if (last?.kind === input.kind && last.publicReason === input.publicReason.trim()) return coreOk(current.value);
    const resolved = fromDomain(resolveCorrectionAppeal(current.value, { actor: input.actor, expectedVersion: input.expectedVersion, kind: input.kind, publicReason: input.publicReason }, { clock: this.clock, idFactory: this.idFactory }));
    return resolved.ok ? fromDomain(this.store.correctionAppeals.compareAndSwap(resolved.value, current.value.version)) : resolved;
  }

  private require(projectId: string, appealId: string): CoreResult<CorrectionAppeal> {
    const value = this.get(projectId, appealId); if (!value.ok) return value;
    return value.value === undefined ? coreErr("not_found") : coreOk(value.value);
  }

  private validProvider(provider: CorrectionAppealSecondOpinionProvider): boolean {
    const identity = createCorrectionAppealProviderEndpointIdentityHash(provider.binding);
    return provider.id === provider.binding.id && provider.connectionId.trim().length > 0 && identity !== undefined && identity === provider.endpointIdentityHash && provider.binding.configGeneration > 0;
  }

  private latestResolvedForSource(projectId: string, reviewId: string, findingId: string): CoreResult<CorrectionAppeal | undefined> {
    const listed = this.list(projectId); if (!listed.ok) return listed;
    return coreOk(listed.value.find((item) => item.status === "resolved" && item.source.reviewId === reviewId && item.source.findingId === findingId));
  }

  private sourceFromReceipt(receipt: ResearchRoomReceipt, findingId: string): CoreResult<AppealSourceBinding> {
    const trace = receipt.semanticJudge;
    const semanticManifest = receipt.manifest.semanticJudge;
    if (trace === undefined || semanticManifest === undefined || receipt.providerStatus !== "semantic_ready") return coreErr("review_blocked");
    const finding = trace.findings.find((item) => item.id === findingId); if (finding === undefined) return coreErr("not_found");
    const criterionId = FINDING_KIND_TO_CRITERION[finding.kind]; if (criterionId === undefined) return coreErr("state_conflict");
    const assessment = trace.assessments.find((item) => item.criterionId === criterionId && item.verdict === "positive");
    if (assessment?.publicRationale !== finding.rationale || assessment.minimalCorrection !== finding.minimumRecovery || !same(assessment.referencedDecisionIds, finding.decisionIds) || !same(assessment.referencedIssueIds, finding.issueIds) || assessment.evidenceSpans.length === 0) return coreErr("state_conflict");
    const state = this.readResearchRoomState(receipt.projectId); if (!state.ok) return state;
    const findingSnapshot = Object.freeze({ id: finding.id, kind: finding.kind, severity: finding.severity, rationale: finding.rationale, minimumRecovery: finding.minimumRecovery, decisionIds: finding.decisionIds, issueIds: finding.issueIds, authority: "model_proposed" as const });
    const findingHash = stableResearchHash(findingSnapshot);
    const stateHash = stableResearchHash(state.value.stateBinding);
    if (!findingHash.ok || !stateHash.ok) return coreErr("infrastructure_failure");
    const bindings = [...new Map(assessment.evidenceSpans.map((span) => [`${span.artifactId}:${span.revisionId}:${span.normalizedTextHash}`, Object.freeze({ artifactId: span.artifactId, revisionId: span.revisionId, normalizedTextHash: span.normalizedTextHash })])).values()];
    const currentCriterion = getResearchRoomSemanticCriterionDefinition(criterionId);
    const definition = currentCriterion?.version === semanticManifest.rubric.version && currentCriterion.sourceRubricHash === semanticManifest.rubric.hash
      ? currentCriterion.definition
      : `Historical semantic criterion ${criterionId} from rubric ${semanticManifest.rubric.version}; the full definition is unavailable in this receipt.`;
    const criterionHash = stableResearchHash({ id: criterionId, definition, version: semanticManifest.rubric.version });
    if (!criterionHash.ok) return coreErr("infrastructure_failure");
    return coreOk(Object.freeze({
      projectId: receipt.projectId,
      reviewId: receipt.reviewId,
      receiptId: receipt.id,
      findingId: finding.id,
      findingSchemaVersion: "1.0.0" as const,
      findingSnapshot,
      findingHash: findingHash.value,
      suggestionHash: receipt.suggestionHash,
      sourceReceiptHash: receipt.receiptHash,
      inputBindings: Object.freeze(bindings),
      rubric: Object.freeze({ criterionId, version: semanticManifest.rubric.version, definition, hash: criterionHash.value, sourceRubricHash: semanticManifest.rubric.hash }),
      createdStateBinding: state.value.stateBinding,
      createdStateBindingHash: stateHash.value,
    }));
  }

  private boundReceipt(appeal: CorrectionAppeal): CoreResult<ResearchRoomReceipt> {
    const result = fromDomain(this.store.roomReceipts.getById(appeal.projectId, appeal.source.receiptId));
    if (!result.ok) return result;
    if (result.value === undefined) return coreErr("not_found");
    const receipt = result.value;
    const finding = receipt.semanticJudge?.findings.find((item) => item.id === appeal.source.findingId);
    const snapshot = finding === undefined ? undefined : { id: finding.id, kind: finding.kind, severity: finding.severity, rationale: finding.rationale, minimumRecovery: finding.minimumRecovery, decisionIds: finding.decisionIds, issueIds: finding.issueIds, authority: "model_proposed" as const };
    const snapshotHash = snapshot === undefined ? undefined : stableResearchHash(snapshot);
    if (receipt.receiptHash !== appeal.source.sourceReceiptHash || receipt.suggestionHash !== appeal.source.suggestionHash || snapshotHash === undefined || !snapshotHash.ok || snapshotHash.value !== appeal.source.findingHash) return coreErr("stale_state");
    return coreOk(receipt);
  }

  private allowedObjects(state: ResearchRoomState, selection: CorrectionAppealAllowedContextSelection): CoreResult<readonly CorrectionAppealAllowedContextObject[]> {
    const decisionIds = uniqueStrings(selection.decisionIds); const issueIds = uniqueStrings(selection.issueIds); const evidenceIds = uniqueStrings(selection.evidenceIds);
    if (typeof selection.includeBrief !== "boolean" || decisionIds === undefined || issueIds === undefined || evidenceIds === undefined) return coreErr("invalid_input");
    const values: CorrectionAppealAllowedContextObject[] = [];
    const add = (kind: CorrectionAppealAllowedContextObject["kind"], id: string, version: number, fields: Readonly<Record<string, string>>): CoreResult<void> => {
      const calculated = stableResearchHash({ kind, id, version, fields });
      if (!calculated.ok) return coreErr("infrastructure_failure");
      values.push(Object.freeze({ kind, id, version, hash: calculated.value, fields: Object.freeze({ ...fields }) }));
      return coreOk(undefined);
    };
    if (selection.includeBrief) {
      const added = add("brief", state.brief.versionId, state.brief.versionNumber, { projectQuestion: state.brief.projectQuestion, currentStage: state.brief.currentStage, currentTask: state.brief.currentTask });
      if (!added.ok) return added;
    }
    for (const id of decisionIds) {
      const decision = state.decisions.find((item) => item.id === id); if (decision === undefined) return coreErr("not_found");
      const added = add("decision", decision.id, decision.version, { statement: decision.statement, rationale: decision.rationale, status: decision.status }); if (!added.ok) return added;
    }
    for (const id of issueIds) {
      const issue = state.issues.find((item) => item.id === id); if (issue === undefined) return coreErr("not_found");
      const added = add("issue", issue.id, issue.version, { summary: issue.summary, issueKind: issue.kind, status: issue.status }); if (!added.ok) return added;
    }
    for (const id of evidenceIds) {
      if (!parseResearchIdFor(id, "revd_").ok) return coreErr("invalid_input");
      const stored = fromDomain(this.store.argumentEvidence.getById(state.project.id, id)); if (!stored.ok) return stored;
      if (stored.value === undefined) return coreErr("not_found");
      const evidence = stored.value;
      const added = add("evidence", evidence.id, evidence.version, { summary: evidence.summary, evidenceKind: evidence.kind, state: evidence.state, inferenceCapacity: evidence.inferenceCapacity }); if (!added.ok) return added;
    }
    values.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    return coreOk(Object.freeze(values));
  }

  private requestFor(appeal: CorrectionAppeal, receipt: ResearchRoomReceipt, attemptId: string, allowedContext: readonly CorrectionAppealAllowedContextObject[]): CoreResult<CorrectionAppealSecondOpinionRequest> {
    if (this.provider === undefined) return coreErr("review_blocked");
    const binding = appeal.source.inputBindings[0]; const statement = appeal.statements.at(-1)?.statement;
    if (binding === undefined || statement === undefined) return coreErr("state_conflict");
    const request = prepareCorrectionAppealSecondOpinionRequest({
      appealId: appeal.id,
      attemptId,
      projectId: appeal.projectId,
      reviewId: appeal.source.reviewId,
      findingId: appeal.source.findingId,
      findingHash: appeal.source.findingHash,
      stateBindingHash: appeal.source.createdStateBindingHash,
      provider: this.provider.binding,
      criterion: { id: appeal.source.rubric.criterionId, definition: appeal.source.rubric.definition, version: appeal.source.rubric.version, hash: appeal.source.rubric.hash },
      userQuestion: statement.secondOpinionQuestion,
      frozenInput: { projectId: appeal.projectId, artifactId: binding.artifactId, revisionId: binding.revisionId, text: receipt.analysis.proposal },
      allowedContext,
    });
    return request.ok ? coreOk(request.value) : coreErr("review_blocked");
  }

  private reconstruct(appeal: CorrectionAppeal, attemptId: string): CoreResult<{ readonly request: CorrectionAppealSecondOpinionRequest; readonly preview: CorrectionAppealSecondOpinionProviderInput }> {
    if (this.provider === undefined || !this.validProvider(this.provider)) return coreErr("review_blocked");
    const attempt = appeal.attempts.find((item) => item.id === attemptId); if (attempt === undefined) return coreErr("not_found");
    if (attempt.participant.connectionId !== this.provider.connectionId || attempt.participant.providerId !== this.provider.id || attempt.participant.endpointIdentityHash !== this.provider.endpointIdentityHash || attempt.participant.configGeneration !== this.provider.binding.configGeneration || !same(attempt.participant.model, this.provider.binding.model)) return coreErr("review_blocked");
    const receipt = this.boundReceipt(appeal); if (!receipt.ok) return receipt;
    const request = this.requestFor(appeal, receipt.value, attemptId, attempt.manifest.includedObjects); if (!request.ok) return request;
    let preview: CorrectionAppealSecondOpinionProviderInput;
    try { preview = this.provider.prepare(request.value); } catch { return coreErr("review_blocked"); }
    return validateProviderPreview(request.value, preview) ? coreOk(Object.freeze({ request: request.value, preview })) : coreErr("review_blocked");
  }

  private preparedProjection(appeal: CorrectionAppeal, attemptId: string): CoreResult<PreparedCorrectionAppealSecondOpinion> {
    const attempt = appeal.attempts.find((item) => item.id === attemptId); if (attempt === undefined) return coreErr("not_found");
    const rebuilt = this.reconstruct(appeal, attemptId); if (!rebuilt.ok) return rebuilt;
    if (rebuilt.value.request.requestHash !== attempt.manifest.requestHash || rebuilt.value.preview.requestBodyHash !== attempt.manifest.requestBodyHash || rebuilt.value.preview.requestBodyBytes !== attempt.manifest.requestBodyBytes) return coreErr("stale_state");
    return coreOk(Object.freeze({ contextManifestVisible: true as const, appeal, attemptId, confirmationNonce: attempt.confirmationNonce, manifest: attempt.manifest, request: rebuilt.value.request, providerPreview: Object.freeze({ endpoint: rebuilt.value.preview.endpoint, requestBodyBytes: rebuilt.value.preview.requestBodyBytes, responseLimitBytes: rebuilt.value.preview.responseLimitBytes, retryCount: 0 as const, redirectPolicy: "error" as const }) }));
  }

  private persistStale(appeal: CorrectionAppeal, reason: string): CoreResult<never> {
    if (appeal.status !== "stale_conflicted" && appeal.status !== "resolved") {
      const stale = markCorrectionAppealStale(appeal, { expectedVersion: appeal.version, reason }, this.clock);
      if (stale.ok) this.store.correctionAppeals.compareAndSwap(stale.value, appeal.version);
    }
    return coreErr("stale_state");
  }

  private startThenFail(appeal: CorrectionAppeal, input: RunCorrectionAppealSecondOpinionInput, failure: SecondOpinionFailure): CoreResult<CorrectionAppeal> {
    const started = startCorrectionAppealSecondOpinion(appeal, { actor: input.actor, expectedVersion: input.expectedVersion, attemptId: input.attemptId, confirmationNonce: input.confirmationNonce, manifestHash: input.manifestHash }, this.clock);
    if (!started.ok) return fromDomain(started);
    const stored = this.store.correctionAppeals.compareAndSwap(started.value, appeal.version); if (!stored.ok) return fromDomain(stored);
    const failed = failCorrectionAppealSecondOpinion(stored.value, { expectedVersion: stored.value.version, attemptId: input.attemptId, failure }, this.clock);
    return failed.ok ? fromDomain(this.store.correctionAppeals.compareAndSwap(failed.value, stored.value.version)) : fromDomain(failed);
  }

  private failInterrupted(appeal: CorrectionAppeal, attemptId: string): CoreResult<CorrectionAppeal> {
    const failed = failCorrectionAppealSecondOpinion(appeal, { expectedVersion: appeal.version, attemptId, failure: "result_write_uncertain" }, this.clock);
    return failed.ok ? fromDomain(this.store.correctionAppeals.compareAndSwap(failed.value, appeal.version)) : fromDomain(failed);
  }

  private persistFailure(appeal: CorrectionAppeal, attemptId: string, failure: SecondOpinionFailure): CoreResult<CorrectionAppeal> {
    const failed = failCorrectionAppealSecondOpinion(appeal, { expectedVersion: appeal.version, attemptId, failure }, this.clock);
    return failed.ok ? fromDomain(this.store.correctionAppeals.compareAndSwap(failed.value, appeal.version)) : fromDomain(failed);
  }

  private async invokeProvider(appeal: CorrectionAppeal, request: CorrectionAppealSecondOpinionRequest, preview: CorrectionAppealSecondOpinionProviderInput, controller: AbortController): Promise<CoreResult<CorrectionAppeal>> {
    if (this.provider === undefined) return this.persistFailure(appeal, request.attemptId, "provider_configuration_changed");
    let timedOut = false;
    const timeoutMs = Math.min(Math.max(this.timeoutMs, 10), MAX_PROVIDER_TIMEOUT_MS);
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await Promise.race([
        this.provider.analyze(request, preview, { signal: controller.signal }),
        new Promise<never>((_resolve, reject) => { controller.signal.addEventListener("abort", () => { reject(Object.assign(new Error(timedOut ? "provider_timeout" : "provider_aborted"), { code: timedOut ? "provider_timeout" : "provider_aborted" })); }, { once: true }); }),
      ]);
      const current = this.require(appeal.projectId, appeal.id); if (!current.ok) return current;
      const last = current.value.attempts.at(-1);
      if (last?.id !== request.attemptId || last.status === "cancelled") return coreErr("operation_cancelled");
      if (last.status !== "running") return coreErr("stale_state");
      const parsed = submitCorrectionAppealSecondOpinion(request, response);
      if (!parsed.ok) return this.persistFailure(current.value, request.attemptId, parsed.error.code === "limit_exceeded" ? "response_too_large" : "response_invalid");
      const receipt = this.boundReceipt(current.value); if (!receipt.ok) return receipt;
      const criterionId = current.value.source.rubric.criterionId;
      const original = receipt.value.semanticJudge?.assessments.find((item) => item.criterionId === criterionId);
      if (original === undefined) return this.persistFailure(current.value, request.attemptId, "response_invalid");
      const comparison = deriveAppealComparison({ originalAssessment: original.verdict === "positive" ? "present" : original.verdict === "negative" ? "not_present" : "uncertain", originalEvidenceHashes: original.evidenceSpans.flatMap((span) => [span.quoteHash, span.normalizedTextHash]), secondOpinion: parsed.value });
      const completed = completeCorrectionAppealSecondOpinion(current.value, { expectedVersion: current.value.version, attemptId: request.attemptId, result: parsed.value, comparison }, this.clock);
      if (!completed.ok) return fromDomain(completed);
      const stored = this.store.correctionAppeals.compareAndSwap(completed.value, current.value.version);
      if (stored.ok) return coreOk(stored.value);
      const reread = this.require(appeal.projectId, appeal.id);
      return reread.ok && reread.value.status === "second_opinion_running" ? this.persistFailure(reread.value, request.attemptId, "result_write_uncertain") : fromDomain(stored);
    } catch (error) {
      const current = this.require(appeal.projectId, appeal.id); if (!current.ok) return current;
      const last = current.value.attempts.at(-1);
      if (last?.id === request.attemptId && last.status === "cancelled") return coreErr("operation_cancelled");
      return last?.id === request.attemptId && last.status === "running" ? this.persistFailure(current.value, request.attemptId, normalizedFailure(error, timedOut)) : coreErr("stale_state");
    } finally {
      clearTimeout(timer);
    }
  }
}
