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
  decodePreparedAppealSecondOpinion,
  decodePreparedReview,
  decodeProjectOpenResult,
  decodeProviderConnectionTest,
  decodeProviderStatus,
  decodeProjectOverview,
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
  EvidenceDetailDto,
  EvidenceSummaryDto,
  EpisodeDetailDto,
  EpisodeSummaryDto,
  DirectoryPickerCancellationDto,
  EvidenceClass,
  PreparedReviewDto,
  PreparedAppealSecondOpinionDto,
  ProjectOverviewDto,
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

  async listResearchObjects(kind: ResearchObjectKind, input: WorkspaceListRequest): Promise<WorkspacePage<DecisionSummaryDto | IssueSummaryDto | EvidenceSummaryDto | EpisodeSummaryDto | ObjectReceiptSummaryDto | AppealSummaryDto>> {
    const collection = kind === "decision" ? "decisions" : kind === "issue" ? "issues" : kind === "evidence" ? "evidence" : kind === "episode" ? "episodes" : kind === "receipt" ? "receipts" : "appeals";
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

  async researchObject(kind: ResearchObjectKind, id: string): Promise<DecisionDetailDto | IssueDetailDto | EvidenceDetailDto | EpisodeDetailDto | ObjectReceiptDetailDto | AppealDetailDto> {
    const collection = kind === "decision" ? "decisions" : kind === "issue" ? "issues" : kind === "evidence" ? "evidence" : kind === "episode" ? "episodes" : kind === "receipt" ? "receipts" : "appeals";
    return this.request(`/api/project/${collection}/${encodeURIComponent(id)}`, (value) => decodeResearchObjectDetail(value, kind));
  }

  async attention(): Promise<AttentionDto> { return this.request("/api/project/attention", decodeAttention); }

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

  async prepareReview(suggestion: string, evidenceClass: EvidenceClass): Promise<PreparedReviewDto> {
    return this.request("/api/reviews/prepare", decodePreparedReview, { method: "POST", mutation: true, body: { suggestion, evidenceClass } });
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
}

export const researchRoomApi = new ResearchRoomApi();
