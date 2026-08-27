import {
  ApiPayloadError,
  decodeAnalyzedReview,
  decodeApiEnvelope,
  decodeAttention,
  decodeBriefActivation,
  decodeBriefWorkspace,
  decodeDecisionSupersede,
  decodeDirectoryPickerCancellation,
  decodeLanguage,
  decodePreparedDeliberation,
  decodePreparedDeliberationRetry,
  decodePreparedAppealSecondOpinion,
  decodePreparedReview,
  decodeProjectOpenResult,
  decodeProviderConnectionTest,
  decodeProviderStatus,
  decodeProjectOverview,
  decodeProjectMemoryManifest,
  decodeProjectMemoryProjection,
  decodeProjectMemoryRecord,
  decodeResumeCheckpoint,
  decodeReceiptResult,
  decodeResearchRoomState,
  decodeResearchObjectDetail,
  decodeResearchObjectSearch,
  decodeSelectedDirectory,
  decodeSelectedDirectoryPreview,
  decodeStatus,
  decodeWorkspacePage,
} from "./decoders.js";
import type {
  AnalyzedReviewDto,
  AppLanguage,
  AppealDetailDto,
  AppealResolutionKindDto,
  AppealStatementDto,
  AppealSummaryDto,
  AttentionDto,
  BriefWorkspaceDto,
  CommitDispositionInput,
  DecisionDetailDto,
  DecisionSummaryDto,
  DeliberationRoomDetailDto,
  DeliberationRoomSummaryDto,
  EvidenceDetailDto,
  EvidenceSummaryDto,
  EpisodeDetailDto,
  EpisodeSummaryDto,
  DirectoryPickerCancellationDto,
  EvidenceClass,
  PreparedReviewDto,
  PreparedAppealSecondOpinionDto,
  PreparedDeliberationDto,
  PreparedDeliberationRetryDto,
  ProjectOverviewDto,
  ProjectMemoryContentDto,
  ProjectMemoryKindDto,
  ProjectMemoryManifestDto,
  ProjectMemoryOutboundPolicyDto,
  ProjectMemoryProjectionDto,
  ProjectMemoryRetentionDto,
  ProjectMemorySensitivityDto,
  ProjectOpenResultDto,
  ProviderSaveInput,
  ProviderConnectionTestDto,
  ProviderStatusDto,
  ResearchRoomReceiptDto,
  ResearchRoomStateDto,
  ResearchObjectKind,
  ResearchObjectSearchDto,
  IssueDetailDto,
  IssueSummaryDto,
  ObjectReceiptDetailDto,
  ObjectReceiptSummaryDto,
  SelectedDirectoryDto,
  SelectedDirectoryPreviewDto,
  StatusDto,
  WorkspaceListRequest,
  WorkspacePage,
} from "./dto.js";

interface RequestOptions {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
  readonly mutation?: boolean;
  readonly signal?: AbortSignal;
}

export class ResearchRoomApiError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  constructor(code: string, message: string, recoverable = true) {
    super(message);
    this.name = "ResearchRoomApiError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

function toApiError(error: unknown): ResearchRoomApiError {
  if (error instanceof ResearchRoomApiError) return error;
  if (error instanceof ApiPayloadError) return new ResearchRoomApiError(error.code, error.message, false);
  if (error instanceof DOMException && error.name === "AbortError") return new ResearchRoomApiError("request_cancelled", "The request was cancelled.");
  return new ResearchRoomApiError("offline", "The local Research Room is unavailable. Check that the local service is running.");
}

export class ResearchRoomApi {
  #sessionToken: string | undefined;

  async status(signal?: AbortSignal): Promise<StatusDto> {
    const value = await this.request("/api/status", decodeStatus, { signal });
    this.#sessionToken = value.sessionToken;
    return value;
  }

  async saveLanguage(language: AppLanguage): Promise<{ readonly language: AppLanguage }> {
    return this.request("/api/preferences/language", decodeLanguage, { method: "POST", mutation: true, body: { language } });
  }

  async provider(): Promise<ProviderStatusDto> {
    return this.request("/api/provider", decodeProviderStatus);
  }

  async saveProvider(input: ProviderSaveInput): Promise<ProviderStatusDto> {
    return this.request("/api/provider", decodeProviderStatus, { method: "POST", mutation: true, body: input });
  }

  async deleteProviderConfig(): Promise<ProviderStatusDto> {
    return this.request("/api/provider/config", decodeProviderStatus, { method: "DELETE", mutation: true });
  }

  async deleteProviderSecret(): Promise<ProviderStatusDto> {
    return this.request("/api/provider/secret", decodeProviderStatus, { method: "DELETE", mutation: true });
  }

  async secondOpinionProvider(): Promise<ProviderStatusDto> {
    return this.request("/api/second-opinion-provider", decodeProviderStatus);
  }

  async saveSecondOpinionProvider(input: ProviderSaveInput): Promise<ProviderStatusDto> {
    return this.request("/api/second-opinion-provider", decodeProviderStatus, { method: "POST", mutation: true, body: input });
  }

  async deleteSecondOpinionProviderConfig(): Promise<ProviderStatusDto> {
    return this.request("/api/second-opinion-provider/config", decodeProviderStatus, { method: "DELETE", mutation: true });
  }

  async deleteSecondOpinionProviderSecret(): Promise<ProviderStatusDto> {
    return this.request("/api/second-opinion-provider/secret", decodeProviderStatus, { method: "DELETE", mutation: true });
  }

  async testSecondOpinionProvider(): Promise<ProviderConnectionTestDto> {
    return this.request("/api/second-opinion-provider/test", decodeProviderConnectionTest, { method: "POST", mutation: true, body: {} });
  }

  async selectDirectory(): Promise<SelectedDirectoryDto> {
    return this.request("/api/project/select-directory", decodeSelectedDirectory, { method: "POST", mutation: true, body: {} });
  }

  async previewSelectedDirectory(signal?: AbortSignal): Promise<SelectedDirectoryPreviewDto> {
    return this.request("/api/project/select-directory/preview", decodeSelectedDirectoryPreview, { method: "POST", mutation: true, body: {}, signal });
  }

  async cancelDirectorySelection(): Promise<DirectoryPickerCancellationDto> {
    return this.request("/api/project/select-directory", decodeDirectoryPickerCancellation, { method: "DELETE", mutation: true });
  }

  async initializeSelectedDirectory(confirmationNonce: string): Promise<ProjectOpenResultDto> {
    return this.request("/api/project/initialize-selected", decodeProjectOpenResult, { method: "POST", mutation: true, body: { confirmationNonce } });
  }

  async openProject(projectPath: string, initializeIfNeeded: boolean): Promise<ProjectOpenResultDto> {
    return this.request("/api/project/open", decodeProjectOpenResult, { method: "POST", mutation: true, body: { projectPath, initializeIfNeeded } });
  }

  async activateBrief(projectQuestion: string, currentTask: string): Promise<ResearchRoomStateDto> {
    return this.request("/api/project/brief", decodeResearchRoomState, { method: "POST", mutation: true, body: { projectQuestion, currentTask } });
  }

  async state(): Promise<ResearchRoomStateDto> {
    return this.request("/api/state", decodeResearchRoomState);
  }

  async projectOverview(): Promise<ProjectOverviewDto> {
    return this.request("/api/project/overview", decodeProjectOverview);
  }

  async briefWorkspace(historyLimit = 50): Promise<BriefWorkspaceDto> {
    return this.request(`/api/project/brief?historyLimit=${encodeURIComponent(String(historyLimit))}`, decodeBriefWorkspace);
  }

  async listResearchObjects(kind: ResearchObjectKind, input: WorkspaceListRequest): Promise<WorkspacePage<DecisionSummaryDto | IssueSummaryDto | EvidenceSummaryDto | EpisodeSummaryDto | ObjectReceiptSummaryDto | AppealSummaryDto | DeliberationRoomSummaryDto>> {
    const collection = kind === "decision" ? "decisions" : kind === "issue" ? "issues" : kind === "evidence" ? "evidence" : kind === "episode" ? "episodes" : kind === "receipt" ? "receipts" : kind === "appeal" ? "appeals" : "deliberation-rooms";
    const query = new URLSearchParams({ limit: String(input.limit) });
    if (input.cursor) query.set("cursor", input.cursor);
    if (input.status) query.set("status", input.status);
    if (input.query !== undefined) query.set("query", input.query);
    if (input.source) query.set("source", input.source);
    if (input.scope) query.set("scope", input.scope);
    if (input.active !== undefined) query.set("active", String(input.active));
    if (input.referencedByCurrentBrief !== undefined) query.set("referencedByCurrentBrief", String(input.referencedByCurrentBrief));
    if (input.issueKind) query.set("issueKind", input.issueKind);
    if (input.relevance) query.set("relevance", input.relevance);
    if (input.unresolved !== undefined) query.set("unresolved", String(input.unresolved));
    if (input.disposition) query.set("disposition", input.disposition);
    if (input.providerStatus) query.set("providerStatus", input.providerStatus);
    return this.request(`/api/project/${collection}?${query.toString()}`, (value) => decodeWorkspacePage(value, kind));
  }

  async researchObject(kind: ResearchObjectKind, id: string): Promise<DecisionDetailDto | IssueDetailDto | EvidenceDetailDto | EpisodeDetailDto | ObjectReceiptDetailDto | AppealDetailDto | DeliberationRoomDetailDto> {
    const collection = kind === "decision" ? "decisions" : kind === "issue" ? "issues" : kind === "evidence" ? "evidence" : kind === "episode" ? "episodes" : kind === "receipt" ? "receipts" : kind === "appeal" ? "appeals" : "deliberation-rooms";
    return this.request(`/api/project/${collection}/${encodeURIComponent(id)}`, (value) => decodeResearchObjectDetail(value, kind));
  }

  async attention(): Promise<AttentionDto> { return this.request("/api/project/attention", decodeAttention); }

  async projectMemory(limit = 100, cursor?: string): Promise<ProjectMemoryProjectionDto> {
    const query = new URLSearchParams({ limit: String(limit) }); if (cursor) query.set("cursor", cursor);
    return this.request(`/api/project/memory?${query.toString()}`, decodeProjectMemoryProjection);
  }

  async createProjectMemoryCandidate(input: { readonly projectId: string; readonly kind: ProjectMemoryKindDto; readonly content: ProjectMemoryContentDto; readonly retention: ProjectMemoryRetentionDto; readonly sensitivity: ProjectMemorySensitivityDto; readonly outboundPolicy: ProjectMemoryOutboundPolicyDto; readonly publicReason: string }): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/project/memory/candidates", decodeProjectMemoryRecord, { method: "POST", mutation: true, body: { commandType: "create_project_memory_candidate", confirmed: true, ...input } });
  }

  async pinProjectObjectToMemory(input: { readonly projectId: string; readonly objectKind: string; readonly objectId: string; readonly kind: ProjectMemoryKindDto; readonly content: ProjectMemoryContentDto; readonly retention: ProjectMemoryRetentionDto; readonly sensitivity: ProjectMemorySensitivityDto; readonly outboundPolicy: ProjectMemoryOutboundPolicyDto; readonly publicReason: string }): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/project/memory/pin", decodeProjectMemoryRecord, { method: "POST", mutation: true, body: { commandType: "pin_project_object_to_memory", confirmed: true, ...input } });
  }

  async confirmProjectMemory(projectId: string, itemId: string, expectedVersion: number, publicReason: string): Promise<Readonly<Record<string, unknown>>> {
    return this.memoryMutation(itemId, "confirm", decodeProjectMemoryRecord, { commandType: "confirm_project_memory", projectId, expectedVersion, publicReason, confirmed: true });
  }

  async editProjectMemory(input: { readonly projectId: string; readonly itemId: string; readonly expectedVersion: number; readonly content: ProjectMemoryContentDto; readonly retention: ProjectMemoryRetentionDto; readonly sensitivity: ProjectMemorySensitivityDto; readonly outboundPolicy: ProjectMemoryOutboundPolicyDto; readonly publicReason: string }): Promise<Readonly<Record<string, unknown>>> {
    const { itemId, ...body } = input; return this.memoryMutation(itemId, "edit", decodeProjectMemoryRecord, { commandType: "edit_project_memory", confirmed: true, ...body });
  }

  async renewProjectMemory(projectId: string, itemId: string, expectedVersion: number, retention: ProjectMemoryRetentionDto, publicReason: string): Promise<Readonly<Record<string, unknown>>> {
    return this.memoryMutation(itemId, "renew", decodeProjectMemoryRecord, { commandType: "renew_project_memory", projectId, expectedVersion, retention, publicReason, confirmed: true });
  }

  async retireProjectMemory(projectId: string, itemId: string, expectedVersion: number, publicReason: string): Promise<Readonly<Record<string, unknown>>> {
    return this.memoryMutation(itemId, "retire", decodeProjectMemoryRecord, { commandType: "retire_project_memory", projectId, expectedVersion, publicReason, confirmed: true });
  }

  async forgetProjectMemory(projectId: string, itemId: string, expectedVersion: number, confirmation: string): Promise<Readonly<Record<string, unknown>>> {
    return this.memoryMutation(itemId, "forget", decodeProjectMemoryRecord, { commandType: "forget_project_memory", projectId, expectedVersion, confirmation, publicReason: "user_requested_irreversible_forget", confirmed: true });
  }

  async reviewProjectResume(projectId: string, publicReason: string): Promise<Readonly<Record<string, unknown>>> {
    return this.request("/api/project/memory/checkpoint", decodeResumeCheckpoint, { method: "POST", mutation: true, body: { commandType: "review_project_resume", projectId, publicReason, confirmed: true } });
  }

  async prepareProjectMemoryManifest(projectId: string, selectedItemIds: readonly string[]): Promise<ProjectMemoryManifestDto> {
    return this.request("/api/project/memory/manifests/prepare", decodeProjectMemoryManifest, { method: "POST", mutation: true, body: { commandType: "prepare_project_memory_manifest", projectId, selectedItemIds, confirmed: true } });
  }

  async confirmProjectMemoryManifest(projectId: string, manifest: ProjectMemoryManifestDto): Promise<ProjectMemoryManifestDto> {
    return this.request(`/api/project/memory/manifests/${encodeURIComponent(manifest.manifestId)}/confirm`, decodeProjectMemoryManifest, { method: "POST", mutation: true, body: { commandType: "confirm_project_memory_manifest", projectId, expectedVersion: manifest.version, confirmationNonce: manifest.confirmationNonce, manifestHash: manifest.manifestHash, confirmed: true } });
  }

  async consumeProjectMemoryManifest(projectId: string, manifest: ProjectMemoryManifestDto): Promise<ProjectMemoryManifestDto> {
    return this.request(`/api/project/memory/manifests/${encodeURIComponent(manifest.manifestId)}/consume`, decodeProjectMemoryManifest, { method: "POST", mutation: true, body: { commandType: "consume_project_memory_manifest", projectId, expectedVersion: manifest.version, manifestHash: manifest.manifestHash, confirmed: true } });
  }

  async searchResearchObjects(query: string, limit = 50, cursor?: string): Promise<ResearchObjectSearchDto> {
    const parameters = new URLSearchParams({ q: query, limit: String(limit) });
    if (cursor) parameters.set("cursor", cursor);
    return this.request(`/api/project/search?${parameters.toString()}`, decodeResearchObjectSearch);
  }

  async proposeBriefCandidate(projectId: string, expectedVersion: number, changes: Readonly<Record<string, unknown>>, reason: string): Promise<BriefWorkspaceDto> {
    return this.request("/api/commands/brief/candidate", decodeBriefWorkspace, { method: "POST", mutation: true, body: { commandType: "propose_brief_change", projectId, expectedVersion, changes, reason, confirmed: true } });
  }

  async activateBriefCandidate(projectId: string, proposalId: string, expectedVersion: number, reason: string): Promise<{ readonly schemaVersion: "1.0.0"; readonly workspace: BriefWorkspaceDto; readonly changedFields: readonly string[] }> {
    return this.request("/api/commands/brief/activate", decodeBriefActivation, { method: "POST", mutation: true, body: { commandType: "activate_brief_candidate", projectId, proposalId, expectedVersion, reason, confirmed: true } });
  }

  async recordDecision(input: { readonly projectId: string; readonly expectedVersion: number; readonly effectiveBriefVersionId: string; readonly statement: string; readonly scope: Readonly<Record<string, unknown>>; readonly rationale: string; readonly reopenConditions: readonly string[]; readonly reason: string }): Promise<DecisionDetailDto> {
    return this.request("/api/commands/decisions/record", (value) => decodeResearchObjectDetail(value, "decision") as DecisionDetailDto, { method: "POST", mutation: true, body: { commandType: "record_decision", ...input, confirmed: true } });
  }

  async transitionDecision(input: { readonly projectId: string; readonly decisionId: string; readonly expectedVersion: number; readonly target: "accepted" | "rejected" | "frozen"; readonly reason: string }): Promise<DecisionDetailDto> {
    return this.request("/api/commands/decisions/transition", (value) => decodeResearchObjectDetail(value, "decision") as DecisionDetailDto, { method: "POST", mutation: true, body: { commandType: "transition_decision", ...input, confirmed: true } });
  }

  async supersedeDecision(input: { readonly projectId: string; readonly decisionId: string; readonly expectedVersion: number; readonly effectiveBriefVersionId: string; readonly statement: string; readonly scope: Readonly<Record<string, unknown>>; readonly rationale: string; readonly reopenConditions: readonly string[]; readonly reason: string }): Promise<{ readonly schemaVersion: "1.0.0"; readonly superseded: DecisionDetailDto; readonly replacement: DecisionDetailDto }> {
    return this.request("/api/commands/decisions/supersede", decodeDecisionSupersede, { method: "POST", mutation: true, body: { commandType: "supersede_decision", ...input, confirmed: true } });
  }

  async issueCommand(action: "resolve" | "waive" | "dispute" | "reopen", input: Readonly<Record<string, unknown>>): Promise<IssueDetailDto> {
    const commandType = `${action}_issue`;
    return this.request(`/api/commands/issues/${action}`, (value) => decodeResearchObjectDetail(value, "issue") as IssueDetailDto, { method: "POST", mutation: true, body: { commandType, ...input, confirmed: true } });
  }

  async prepareReview(suggestion: string, evidenceClass: EvidenceClass, selectedMemoryItemIds: readonly string[] = []): Promise<PreparedReviewDto> {
    return this.request("/api/reviews/prepare", decodePreparedReview, { method: "POST", mutation: true, body: { suggestion, evidenceClass, selectedMemoryItemIds } });
  }

  async analyzeReview(prepared: PreparedReviewDto, signal?: AbortSignal): Promise<AnalyzedReviewDto> {
    return this.request("/api/reviews/analyze", decodeAnalyzedReview, { method: "POST", mutation: true, signal, body: { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash } });
  }

  async cancelReview(prepared: PreparedReviewDto): Promise<unknown> {
    return this.request("/api/reviews/cancel", (value) => value, { method: "POST", mutation: true, body: { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash } });
  }

  async commitDisposition(input: CommitDispositionInput): Promise<ResearchRoomReceiptDto> {
    return this.request("/api/reviews/commit", decodeReceiptResult, { method: "POST", mutation: true, body: input });
  }

  async rollbackReceipt(projectId: string, receiptId: string, expectedVersion: number, reason: string): Promise<ObjectReceiptDetailDto> {
    return this.request("/api/commands/receipts/rollback", (value) => decodeResearchObjectDetail(value, "receipt") as ObjectReceiptDetailDto, { method: "POST", mutation: true, body: { commandType: "rollback_receipt", projectId, receiptId, expectedVersion, reason, confirmed: true } });
  }

  async createCorrectionAppeal(projectId: string, receiptId: string, findingId: string, statement: AppealStatementDto): Promise<AppealDetailDto> {
    return this.request("/api/project/appeals", (value) => decodeResearchObjectDetail(value, "appeal") as AppealDetailDto, { method: "POST", mutation: true, body: { commandType: "create_correction_appeal", projectId, receiptId, findingId, statement, confirmed: true } });
  }

  async updateCorrectionAppeal(projectId: string, appealId: string, expectedVersion: number, statement: AppealStatementDto): Promise<AppealDetailDto> {
    return this.request(`/api/project/appeals/${encodeURIComponent(appealId)}/update`, (value) => decodeResearchObjectDetail(value, "appeal") as AppealDetailDto, { method: "POST", mutation: true, body: { commandType: "update_correction_appeal", projectId, expectedVersion, statement, confirmed: true } });
  }

  async recordCorrectionAppeal(projectId: string, appealId: string, expectedVersion: number): Promise<AppealDetailDto> {
    return this.request(`/api/project/appeals/${encodeURIComponent(appealId)}/record`, (value) => decodeResearchObjectDetail(value, "appeal") as AppealDetailDto, { method: "POST", mutation: true, body: { commandType: "record_correction_appeal", projectId, expectedVersion, confirmed: true } });
  }

  async markCorrectionAppealRecordOnly(projectId: string, appealId: string, expectedVersion: number): Promise<AppealDetailDto> {
    return this.request(`/api/project/appeals/${encodeURIComponent(appealId)}/record-only`, (value) => decodeResearchObjectDetail(value, "appeal") as AppealDetailDto, { method: "POST", mutation: true, body: { commandType: "mark_correction_appeal_record_only", projectId, expectedVersion, confirmed: true } });
  }

  async prepareCorrectionAppealSecondOpinion(projectId: string, appealId: string, expectedVersion: number, allowedContext: { readonly includeBrief: boolean; readonly decisionIds: readonly string[]; readonly issueIds: readonly string[]; readonly evidenceIds: readonly string[] }): Promise<PreparedAppealSecondOpinionDto> {
    return this.request(`/api/project/appeals/${encodeURIComponent(appealId)}/prepare-second-opinion`, decodePreparedAppealSecondOpinion, { method: "POST", mutation: true, body: { commandType: "prepare_correction_appeal_second_opinion", projectId, expectedVersion, allowedContext, confirmed: true } });
  }

  async runCorrectionAppealSecondOpinion(projectId: string, appealId: string, expectedVersion: number, prepared: PreparedAppealSecondOpinionDto, signal?: AbortSignal): Promise<AppealDetailDto> {
    return this.request(`/api/project/appeals/${encodeURIComponent(appealId)}/run-second-opinion`, (value) => decodeResearchObjectDetail(value, "appeal") as AppealDetailDto, { method: "POST", mutation: true, signal, body: { commandType: "run_correction_appeal_second_opinion", projectId, expectedVersion, attemptId: prepared.attemptId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifest.canonicalHash, confirmed: true } });
  }

  async cancelCorrectionAppealSecondOpinion(projectId: string, appealId: string, expectedVersion: number, attemptId: string): Promise<AppealDetailDto> {
    return this.request(`/api/project/appeals/${encodeURIComponent(appealId)}/cancel-second-opinion`, (value) => decodeResearchObjectDetail(value, "appeal") as AppealDetailDto, { method: "POST", mutation: true, body: { commandType: "cancel_correction_appeal_second_opinion", projectId, expectedVersion, attemptId, confirmed: true } });
  }

  async resolveCorrectionAppeal(projectId: string, appealId: string, expectedVersion: number, kind: AppealResolutionKindDto, publicReason: string): Promise<AppealDetailDto> {
    return this.request(`/api/project/appeals/${encodeURIComponent(appealId)}/resolve`, (value) => decodeResearchObjectDetail(value, "appeal") as AppealDetailDto, { method: "POST", mutation: true, body: { commandType: "resolve_correction_appeal", projectId, expectedVersion, kind, publicReason, confirmed: true } });
  }

  async createDeliberationRoom(input: { readonly projectId: string; readonly sourceKind: "correction_appeal" | "research_issue" | "research_decision" | "research_brief" | "research_object"; readonly sourceObjectId: string; readonly question: string; readonly title: string }): Promise<DeliberationRoomDetailDto> {
    return this.request("/api/project/deliberation-rooms", (value) => decodeResearchObjectDetail(value, "deliberation_room") as DeliberationRoomDetailDto, { method: "POST", mutation: true, body: { commandType: "create_deliberation_room", commandId: this.commandId("create-room"), confirmed: true, ...input } });
  }

  async refreshDeliberationRoomSource(projectId: string, roomId: string): Promise<DeliberationRoomDetailDto> {
    return this.deliberationMutation(roomId, "refresh-source", { commandType: "refresh_deliberation_source", confirmed: true, projectId });
  }

  async prepareDeliberationRoom(input: { readonly projectId: string; readonly roomId: string; readonly expectedVersion: number; readonly revisionId: string; readonly decisionIds: readonly string[]; readonly issueIds: readonly string[]; readonly evidenceIds: readonly string[] }): Promise<PreparedDeliberationDto> {
    return this.request(`/api/project/deliberation-rooms/${encodeURIComponent(input.roomId)}/prepare`, decodePreparedDeliberation, { method: "POST", mutation: true, body: { commandType: "prepare_deliberation_manifests", commandId: this.commandId("prepare-room"), confirmed: true, projectId: input.projectId, expectedVersion: input.expectedVersion, revisionId: input.revisionId, allowedContext: { includeBrief: true, decisionIds: input.decisionIds, issueIds: input.issueIds, evidenceIds: input.evidenceIds } } });
  }

  async runDeliberationRoom(projectId: string, roomId: string, expectedVersion: number, manifestHashes: readonly [string, string], signal?: AbortSignal): Promise<DeliberationRoomDetailDto> {
    return this.deliberationMutation(roomId, "run", { commandType: "run_deliberation_blind_round", commandId: this.commandId("run-room"), confirmed: true, projectId, expectedVersion, manifestHashes }, signal);
  }

  async cancelDeliberationRun(projectId: string, roomId: string, expectedVersion: number): Promise<DeliberationRoomDetailDto> {
    return this.deliberationMutation(roomId, "cancel", { commandType: "cancel_deliberation_run", commandId: this.commandId("cancel-room"), confirmed: true, projectId, expectedVersion });
  }

  async revealDeliberationRoom(projectId: string, roomId: string, expectedVersion: number, mode: "complete" | "partial" | "cancelled"): Promise<DeliberationRoomDetailDto> {
    return this.deliberationMutation(roomId, "reveal", { commandType: "reveal_deliberation_round", commandId: this.commandId("reveal-room"), confirmed: true, projectId, expectedVersion, mode });
  }

  async prepareDeliberationRetry(projectId: string, roomId: string, expectedVersion: number): Promise<PreparedDeliberationRetryDto> {
    return this.request(`/api/project/deliberation-rooms/${encodeURIComponent(roomId)}/prepare-retry`, decodePreparedDeliberationRetry, { method: "POST", mutation: true, body: { commandType: "prepare_deliberation_participant_retry", commandId: this.commandId("prepare-retry"), confirmed: true, projectId, expectedVersion } });
  }

  async runDeliberationRetry(projectId: string, roomId: string, expectedVersion: number, retryId: string, manifestHash: string, signal?: AbortSignal): Promise<DeliberationRoomDetailDto> {
    return this.deliberationMutation(roomId, "run-retry", { commandType: "run_deliberation_participant_retry", commandId: this.commandId("run-retry"), confirmed: true, projectId, expectedVersion, retryId, manifestHash }, signal);
  }

  async prepareDeliberationChallenge(projectId: string, roomId: string, expectedVersion: number, question: string): Promise<PreparedDeliberationDto> {
    return this.request(`/api/project/deliberation-rooms/${encodeURIComponent(roomId)}/prepare-challenge`, decodePreparedDeliberation, { method: "POST", mutation: true, body: { commandType: "prepare_deliberation_challenge", commandId: this.commandId("prepare-challenge"), confirmed: true, projectId, expectedVersion, question } });
  }

  async runDeliberationChallenge(projectId: string, roomId: string, expectedVersion: number, challengeId: string, manifestHashes: readonly [string, string], signal?: AbortSignal): Promise<DeliberationRoomDetailDto> {
    return this.deliberationMutation(roomId, "run-challenge", { commandType: "run_deliberation_challenge", commandId: this.commandId("run-challenge"), confirmed: true, projectId, expectedVersion, challengeId, manifestHashes }, signal);
  }

  async finishDeliberationReview(projectId: string, roomId: string, expectedVersion: number): Promise<DeliberationRoomDetailDto> {
    return this.deliberationMutation(roomId, "finish-review", { commandType: "finish_deliberation_difference_review", commandId: this.commandId("finish-room"), confirmed: true, projectId, expectedVersion });
  }

  async importManualDeliberationOpinion(input: { readonly projectId: string; readonly roomId: string; readonly expectedVersion: number; readonly sourceLabel: string; readonly providerClaim: string; readonly modelClaim: string; readonly capturedAt: string; readonly contextDisclosure: string; readonly sawParticipantAOutput: boolean; readonly sawParticipantBOutput: boolean; readonly publicContent: string }): Promise<DeliberationRoomDetailDto> {
    const { roomId, ...body } = input;
    return this.deliberationMutation(roomId, "manual-opinion", { commandType: "import_manual_external_opinion", commandId: this.commandId("manual-opinion"), confirmed: true, ...body });
  }

  async resolveDeliberationRoom(input: { readonly projectId: string; readonly roomId: string; readonly expectedVersion: number; readonly kind: "adopt_a" | "adopt_b" | "combine_edit" | "keep_disputed" | "request_evidence" | "close_without_change"; readonly publicReason: string; readonly combinedText?: string }): Promise<DeliberationRoomDetailDto> {
    const { roomId, ...body } = input;
    return this.deliberationMutation(roomId, "resolve", { commandType: "resolve_deliberation_room", commandId: this.commandId("resolve-room"), confirmed: true, ...body, combinedText: input.combinedText ?? "" });
  }

  async downloadReceipt(receiptId: string): Promise<Blob> {
    if (!this.#sessionToken) throw new ResearchRoomApiError("session_unavailable", "The local session is unavailable.");
    try {
      const response = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}/download`, { headers: { "x-sestina-session": this.#sessionToken } });
      if (!response.ok) throw new ResearchRoomApiError("download_failed", "The receipt could not be downloaded.");
      return await response.blob();
    } catch (error) {
      throw toApiError(error);
    }
  }

  private async request<T>(path: string, decode: (value: unknown) => T, options: RequestOptions = {}): Promise<T> {
    if (options.mutation && !this.#sessionToken) throw new ResearchRoomApiError("session_unavailable", "The local session is unavailable.");
    try {
      const response = await fetch(path, {
        method: options.method ?? "GET",
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.mutation ? { "x-sestina-session": this.#sessionToken ?? "" } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ResearchRoomApiError("invalid_payload", "The local service returned invalid JSON.", false);
      }
      try {
        return decodeApiEnvelope(body, decode);
      } catch (error) {
        if (error instanceof ApiPayloadError) throw new ResearchRoomApiError(error.code, error.message, error.code !== "invalid_payload");
        throw error;
      }
    } catch (error) {
      throw toApiError(error);
    }
  }

  private commandId(kind: string): string {
    return `ui:${kind}:${crypto.randomUUID()}`;
  }

  private async memoryMutation<T>(itemId: string, action: string, decode: (value: unknown) => T, body: Readonly<Record<string, unknown>>): Promise<T> {
    return this.request(`/api/project/memory/${encodeURIComponent(itemId)}/${action}`, decode, { method: "POST", mutation: true, body });
  }

  private async deliberationMutation(roomId: string, action: string, body: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<DeliberationRoomDetailDto> {
    return this.request(`/api/project/deliberation-rooms/${encodeURIComponent(roomId)}/${action}`, (value) => decodeResearchObjectDetail(value, "deliberation_room") as DeliberationRoomDetailDto, { method: "POST", mutation: true, body, ...(signal ? { signal } : {}) });
  }
}

export const researchRoomApi = new ResearchRoomApi();
