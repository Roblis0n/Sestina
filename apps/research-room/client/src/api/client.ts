import {
  ApiPayloadError,
  decodeAnalyzedReview,
  decodeApiEnvelope,
  decodeDirectoryPickerCancellation,
  decodeLanguage,
  decodePreparedReview,
  decodeProjectOpenResult,
  decodeProviderStatus,
  decodeReceiptResult,
  decodeResearchRoomState,
  decodeSelectedDirectory,
  decodeSelectedDirectoryPreview,
  decodeStatus,
} from "./decoders.js";
import type {
  AnalyzedReviewDto,
  AppLanguage,
  CommitDispositionInput,
  DirectoryPickerCancellationDto,
  EvidenceClass,
  PreparedReviewDto,
  ProjectOpenResultDto,
  ProviderSaveInput,
  ProviderStatusDto,
  ResearchRoomReceiptDto,
  ResearchRoomStateDto,
  SelectedDirectoryDto,
  SelectedDirectoryPreviewDto,
  StatusDto,
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

  async rollbackReceipt(receiptId: string, expectedVersion: number, reason: string): Promise<ResearchRoomReceiptDto> {
    return this.request(`/api/receipts/${encodeURIComponent(receiptId)}/rollback`, decodeReceiptResult, { method: "POST", mutation: true, body: { expectedVersion, reason } });
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
