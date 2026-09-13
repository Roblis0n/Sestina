import {
  ApiPayloadError,
  decodeLanguage,
  decodeProviderStatus,
  decodeStatus,
} from "./decoders.js";
import type {
  AppLanguage,
  ProviderSaveInput,
  ProviderStatusDto,
  StatusDto,
} from "./dto.js";
import { desktopRequest } from "./desktop.js";
import { decodeLocalJson } from "./kernel-dto.js";
import {
  decodeKernelSession,
  KERNEL_COMMANDS,
  type KernelCommandRequest,
  type KernelTransport,
} from "../../../shared/kernel-port.js";
export class ResearchRoomApiError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  constructor(
    code: string,
    message: string,
    recoverable = true,
    readonly reasons: readonly string[] = [],
    readonly changedObjects: readonly {
      kind: string;
      id: string;
      version: number;
    }[] = [],
  ) {
    super(message);
    this.name = "ResearchRoomApiError";
    this.code = code;
    this.recoverable = recoverable;
  }
}
interface RequestOptions {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
  readonly mutation?: boolean;
  readonly signal?: AbortSignal;
}
/** The installed renderer has no HTTP fallback or legacy research commands. */
export class ResearchRoomApi {
  #sessionToken: string | undefined;
  #kernelGeneration = 0;
  #kernelSessionGeneration: number | undefined;
  async status(signal?: AbortSignal): Promise<StatusDto> {
    const value = await this.request("/api/status", decodeStatus, { signal });
    this.#sessionToken = value.sessionToken;
    return value;
  }
  async saveLanguage(
    language: AppLanguage,
  ): Promise<{ readonly language: AppLanguage }> {
    return this.request("/api/preferences/language", decodeLanguage, {
      method: "POST",
      mutation: true,
      body: { language },
    });
  }
  async provider(): Promise<ProviderStatusDto> {
    return this.request("/api/provider", decodeProviderStatus);
  }
  async saveProvider(input: ProviderSaveInput): Promise<ProviderStatusDto> {
    return this.request("/api/provider", decodeProviderStatus, {
      method: "POST",
      mutation: true,
      body: input,
    });
  }
  async deleteProviderConfig(): Promise<ProviderStatusDto> {
    return this.request("/api/provider/config", decodeProviderStatus, {
      method: "DELETE",
      mutation: true,
    });
  }
  async deleteProviderSecret(): Promise<ProviderStatusDto> {
    return this.request("/api/provider/secret", decodeProviderStatus, {
      method: "DELETE",
      mutation: true,
    });
  }
  async secondOpinionProvider(): Promise<ProviderStatusDto> {
    return this.request("/api/second-opinion-provider", decodeProviderStatus);
  }
  async saveSecondOpinionProvider(
    input: ProviderSaveInput,
  ): Promise<ProviderStatusDto> {
    return this.request("/api/second-opinion-provider", decodeProviderStatus, {
      method: "POST",
      mutation: true,
      body: input,
    });
  }
  async deleteSecondOpinionProviderConfig(): Promise<ProviderStatusDto> {
    return this.request(
      "/api/second-opinion-provider/config",
      decodeProviderStatus,
      { method: "DELETE", mutation: true },
    );
  }
  async deleteSecondOpinionProviderSecret(): Promise<ProviderStatusDto> {
    return this.request(
      "/api/second-opinion-provider/secret",
      decodeProviderStatus,
      { method: "DELETE", mutation: true },
    );
  }
  async kernelOpen(projectPath: string, readOnly = false) {
    const generation = ++this.#kernelGeneration;
    this.#kernelSessionGeneration = undefined;
    const value = await this.request("/api/kernel/open", decodeLocalJson, {
      method: "POST",
      mutation: true,
      body: { projectPath, readOnly },
    });
    if (generation !== this.#kernelGeneration)
      throw new ResearchRoomApiError(
        "session_changed",
        "The project session changed.",
      );
    this.#kernelSessionGeneration =
      decodeKernelSession(value).sessionGeneration;
    return value;
  }
  async kernelSession() {
    const generation = this.#kernelGeneration;
    const value = await this.request("/api/kernel/status", decodeKernelSession);
    if (generation !== this.#kernelGeneration)
      throw new ResearchRoomApiError(
        "session_changed",
        "The project session changed.",
      );
    this.#kernelSessionGeneration = value.sessionGeneration;
    return value;
  }
  async repairKernelBrief(projectPath: string) {
    return this.request("/api/kernel/repair-brief", decodeLocalJson, {
      method: "POST",
      mutation: true,
      body: { projectPath, confirmed: true },
    });
  }
  async kernelClose() {
    this.#kernelGeneration++;
    this.#kernelSessionGeneration = undefined;
    return this.request("/api/kernel/close", decodeLocalJson, {
      method: "POST",
      mutation: true,
      body: {},
    });
  }
  async kernelCreate(projectPath: string, title: string) {
    const generation = ++this.#kernelGeneration;
    this.#kernelSessionGeneration = undefined;
    const value = await this.request("/api/kernel/create", decodeLocalJson, {
      method: "POST",
      mutation: true,
      body: { projectPath, title, confirmed: true },
    });
    if (generation !== this.#kernelGeneration)
      throw new ResearchRoomApiError(
        "session_changed",
        "The project session changed.",
      );
    this.#kernelSessionGeneration =
      decodeKernelSession(value).sessionGeneration;
    return decodeKernelSession(value);
  }
  async kernelMaintenance(body: Record<string, unknown>) {
    return this.request("/api/kernel/maintenance", decodeLocalJson, {
      method: "POST",
      mutation: true,
      body,
    });
  }
  async kernel<T>(
    projectId: string,
    action: string,
    body: Record<string, unknown>,
    decode: (v: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const generation = this.#kernelGeneration;
    if (
      !(KERNEL_COMMANDS as readonly string[]).includes(action) ||
      this.#kernelSessionGeneration === undefined
    )
      throw new ResearchRoomApiError(
        "invalid_payload",
        "Invalid local request.",
      );
    const request = decodeLocalJson({
      action,
      projectId,
      ...body,
      sessionGeneration: this.#kernelSessionGeneration,
    }) as unknown as KernelCommandRequest;
    const transport: KernelTransport = {
      invoke: (request, signal) =>
        this.request("/api/kernel/reviews", (value) => value, {
          method: "POST",
          mutation: true,
          body: request,
          ...(signal ? { signal } : {}),
        }),
    };
    const value = decode(await transport.invoke(request, signal));
    if (generation !== this.#kernelGeneration)
      throw new ResearchRoomApiError(
        "session_changed",
        "The project session changed.",
      );
    return value;
  }
  private async request<T>(
    path: string,
    decode: (value: unknown) => T,
    options: RequestOptions = {},
  ): Promise<T> {
    if (options.mutation && !this.#sessionToken)
      throw new ResearchRoomApiError(
        "session_unavailable",
        "The local session is unavailable.",
      );
    try {
      if (options.signal?.aborted)
        throw new DOMException("Cancelled", "AbortError");
      const reply = await desktopRequest(
        path,
        options.method ?? "GET",
        options.body,
      );
      if (options.signal?.aborted)
        throw new DOMException("Cancelled", "AbortError");
      if (!reply.ok)
        throw new ResearchRoomApiError(
          reply.error?.code ?? "operation_failed",
          reply.error?.code ?? "operation_failed",
          true,
          reply.error?.reasons,
        );
      return decode(reply.value);
    } catch (error) {
      if (error instanceof ResearchRoomApiError) throw error;
      if (error instanceof ApiPayloadError)
        throw new ResearchRoomApiError(error.code, error.message, false);
      if (error instanceof DOMException && error.name === "AbortError")
        throw new ResearchRoomApiError(
          "request_cancelled",
          "The request was cancelled.",
        );
      throw new ResearchRoomApiError(
        "offline",
        "The local Research Room is unavailable.",
      );
    }
  }
}
export const researchRoomApi = new ResearchRoomApi();
