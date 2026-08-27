import { createHash } from "node:crypto";
import {
  compileCorrectionAppealSecondOpinionPrompt,
  compileDeliberationParticipantPrompt,
  compileResearchRoomSemanticJudgePrompt,
  createCorrectionAppealProviderEndpointIdentityHash,
  type CorrectionAppealSecondOpinionProvider,
  type CorrectionAppealSecondOpinionProviderInput,
  type CorrectionAppealSecondOpinionRequest,
  type DeliberationParticipantProvider,
  type DeliberationParticipantProviderInput,
  type DeliberationParticipantRequest,
  type ResearchRoomSemanticJudgeRequest,
  type ResearchRoomSemanticProviderBinding,
} from "@sestina/core";
import type { ProviderRuntimeSnapshot } from "./provider-settings.js";

export type OpenAICompatibleProviderErrorCode =
  | "provider_invalid_request"
  | "provider_configuration_changed"
  | "provider_aborted"
  | "provider_timeout"
  | "provider_network_failed"
  | "provider_http_error"
  | "provider_invalid_response"
  | "provider_response_too_large";

const SAFE_MESSAGES: Readonly<Record<OpenAICompatibleProviderErrorCode, string>> = Object.freeze({
  provider_invalid_request: "The locked Semantic Judge request is invalid.",
  provider_configuration_changed: "The Provider configuration changed after the manifest was prepared.",
  provider_aborted: "The Provider request was cancelled.",
  provider_timeout: "The Provider did not respond before the configured timeout.",
  provider_network_failed: "The Provider request could not be completed.",
  provider_http_error: "The Provider returned a non-success status.",
  provider_invalid_response: "The Provider returned an invalid response envelope.",
  provider_response_too_large: "The Provider response exceeded the configured safety limit.",
});

export class OpenAICompatibleProviderError extends Error {
  constructor(readonly code: OpenAICompatibleProviderErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "OpenAICompatibleProviderError";
  }
}

export interface OpenAICompatibleCallPreview {
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

export interface OpenAICompatibleProvider {
  readonly id: string;
  readonly kind: "local" | "external";
  readonly networkAccess: "loopback" | "external";
  readonly binding: ResearchRoomSemanticProviderBinding;
  prepare(request: ResearchRoomSemanticJudgeRequest): OpenAICompatibleCallPreview;
  analyze(
    request: ResearchRoomSemanticJudgeRequest,
    preview: OpenAICompatibleCallPreview,
    options: { readonly signal: AbortSignal },
  ): Promise<string>;
}

export interface CreateOpenAICompatibleProviderOptions {
  readonly readCurrentGeneration: () => Promise<number | undefined>;
  readonly fetchImplementation?: typeof fetch;
}

export interface OpenAICompatibleConnectionTestResult {
  readonly reachable: true;
  readonly requestKind: "metadata_only_no_research_context";
  readonly endpoint: string;
  readonly providerId: string;
  readonly model: string;
  readonly locality: "local" | "external";
  readonly httpStatus: number;
}

export async function testOpenAICompatibleProviderConnection(
  snapshot: ProviderRuntimeSnapshot,
  options: { readonly fetchImplementation?: typeof fetch } = {},
): Promise<OpenAICompatibleConnectionTestResult> {
  const endpoint = `${snapshot.config.baseUrl}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, snapshot.config.timeoutMs);
  let response: Response;
  try {
    response = await (options.fetchImplementation ?? fetch)(endpoint, {
      method: "GET",
      headers: { accept: "application/json", ...(snapshot.apiKey === undefined ? {} : { authorization: `Bearer ${snapshot.apiKey}` }) },
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw new OpenAICompatibleProviderError(controller.signal.aborted ? "provider_timeout" : "provider_network_failed");
  } finally { clearTimeout(timer); }
  try { await response.body?.cancel(); } catch { /* Metadata test never retains a response body. */ }
  if (!response.ok) throw new OpenAICompatibleProviderError("provider_http_error");
  return Object.freeze({ reachable: true, requestKind: "metadata_only_no_research_context", endpoint, providerId: snapshot.config.providerId, model: snapshot.config.model, locality: snapshot.config.locality, httpStatus: response.status });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameBinding(left: ResearchRoomSemanticProviderBinding, right: ResearchRoomSemanticProviderBinding): boolean {
  return left.id === right.id
    && left.model === right.model
    && left.baseUrlOrigin === right.baseUrlOrigin
    && left.locality === right.locality
    && left.configGeneration === right.configGeneration;
}

function compileBody(snapshot: ProviderRuntimeSnapshot, request: ResearchRoomSemanticJudgeRequest): string {
  const compiled = compileResearchRoomSemanticJudgePrompt(request);
  if (!compiled.ok) throw new OpenAICompatibleProviderError("provider_invalid_request");
  return JSON.stringify({
    model: snapshot.config.model,
    messages: compiled.value.messages,
    temperature: 0,
    stream: false,
    response_format: { type: "json_object" },
    ...(snapshot.config.maxOutputTokens === undefined ? {} : { max_tokens: snapshot.config.maxOutputTokens }),
  });
}

function compileSecondOpinionBody(snapshot: ProviderRuntimeSnapshot, request: CorrectionAppealSecondOpinionRequest): string {
  const compiled = compileCorrectionAppealSecondOpinionPrompt(request);
  if (!compiled.ok) throw new OpenAICompatibleProviderError("provider_invalid_request");
  return JSON.stringify({
    model: snapshot.config.model,
    messages: compiled.value.messages,
    temperature: 0,
    stream: false,
    response_format: { type: "json_object" },
    ...(snapshot.config.maxOutputTokens === undefined ? {} : { max_tokens: snapshot.config.maxOutputTokens }),
  });
}

function previewFor(snapshot: ProviderRuntimeSnapshot, binding: ResearchRoomSemanticProviderBinding, request: ResearchRoomSemanticJudgeRequest): OpenAICompatibleCallPreview {
  if (!sameBinding(request.provider, binding)) throw new OpenAICompatibleProviderError("provider_invalid_request");
  const requestBody = compileBody(snapshot, request);
  return Object.freeze({
    schemaVersion: "1.0.0",
    endpoint: `${snapshot.config.baseUrl}/chat/completions`,
    provider: binding,
    requestHash: request.requestHash,
    requestBody,
    requestBodyHash: sha256(requestBody),
    requestBodyBytes: Buffer.byteLength(requestBody, "utf8"),
    responseLimitBytes: request.limits.maxResponseBytes,
    redirectPolicy: "error",
    retryCount: 0,
  });
}

function secondOpinionPreviewFor(snapshot: ProviderRuntimeSnapshot, binding: ResearchRoomSemanticProviderBinding, request: CorrectionAppealSecondOpinionRequest): CorrectionAppealSecondOpinionProviderInput {
  if (!sameBinding(request.provider, binding)) throw new OpenAICompatibleProviderError("provider_invalid_request");
  const requestBody = compileSecondOpinionBody(snapshot, request);
  return Object.freeze({
    schemaVersion: "1.0.0",
    endpoint: `${snapshot.config.baseUrl}/chat/completions`,
    provider: binding,
    requestHash: request.requestHash,
    requestBody,
    requestBodyHash: sha256(requestBody),
    requestBodyBytes: Buffer.byteLength(requestBody, "utf8"),
    responseLimitBytes: request.limits.maxResponseBytes,
    redirectPolicy: "error",
    retryCount: 0,
  });
}

function validPreview(actual: OpenAICompatibleCallPreview, expected: OpenAICompatibleCallPreview): boolean {
  return actual.endpoint === expected.endpoint
    && sameBinding(actual.provider, expected.provider)
    && actual.requestHash === expected.requestHash
    && actual.requestBody === expected.requestBody
    && actual.requestBodyHash === expected.requestBodyHash
    && actual.requestBodyBytes === expected.requestBodyBytes
    && actual.responseLimitBytes === expected.responseLimitBytes;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new OpenAICompatibleProviderError("provider_response_too_large");
  if (response.body === null) throw new OpenAICompatibleProviderError("provider_invalid_response");
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    let part = await reader.read();
    while (!part.done) {
      const chunk = part.value;
      length += chunk.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new OpenAICompatibleProviderError("provider_response_too_large");
      }
      chunks.push(chunk);
      part = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function extractAssistantContent(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return undefined;
  const choice: unknown = choices[0];
  if (typeof choice !== "object" || choice === null || Array.isArray(choice)) return undefined;
  const message = (choice as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) return undefined;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" && content.trim().length > 0 ? content : undefined;
}

export function createOpenAICompatibleProvider(
  snapshot: ProviderRuntimeSnapshot,
  options: CreateOpenAICompatibleProviderOptions,
): OpenAICompatibleProvider {
  const binding: ResearchRoomSemanticProviderBinding = Object.freeze({
    id: snapshot.config.providerId,
    family: "openai_compatible",
    model: snapshot.config.model,
    baseUrlOrigin: new URL(snapshot.config.baseUrl).origin,
    locality: snapshot.config.locality,
    configGeneration: snapshot.config.generation,
  });
  const fetchImplementation = options.fetchImplementation ?? fetch;
  return Object.freeze({
    id: snapshot.config.providerId,
    kind: snapshot.config.locality,
    networkAccess: snapshot.config.locality === "external" ? "external" as const : "loopback" as const,
    binding,
    prepare(request: ResearchRoomSemanticJudgeRequest): OpenAICompatibleCallPreview {
      return previewFor(snapshot, binding, request);
    },
    async analyze(
      request: ResearchRoomSemanticJudgeRequest,
      preview: OpenAICompatibleCallPreview,
      { signal }: { readonly signal: AbortSignal },
    ): Promise<string> {
      const expected = previewFor(snapshot, binding, request);
      if (!validPreview(preview, expected)) throw new OpenAICompatibleProviderError("provider_invalid_request");
      if (await options.readCurrentGeneration() !== snapshot.config.generation) throw new OpenAICompatibleProviderError("provider_configuration_changed");
      if (signal.aborted) throw new OpenAICompatibleProviderError("provider_aborted");

      const controller = new AbortController();
      const abortState = { timedOut: false, callerAborted: false };
      const propagateAbort = () => { abortState.callerAborted = true; controller.abort(); };
      signal.addEventListener("abort", propagateAbort, { once: true });
      const timer = setTimeout(() => { abortState.timedOut = true; controller.abort(); }, snapshot.config.timeoutMs);
      let response: Response;
      try {
        response = await fetchImplementation(expected.endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(snapshot.apiKey === undefined ? {} : { authorization: `Bearer ${snapshot.apiKey}` }),
          },
          body: expected.requestBody,
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        if (abortState.timedOut) throw new OpenAICompatibleProviderError("provider_timeout");
        if (abortState.callerAborted) throw new OpenAICompatibleProviderError("provider_aborted");
        throw new OpenAICompatibleProviderError("provider_network_failed");
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", propagateAbort);
      }
      if (!response.ok) throw new OpenAICompatibleProviderError("provider_http_error");
      const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") throw new OpenAICompatibleProviderError("provider_invalid_response");
      let raw: string;
      try { raw = await readBoundedBody(response, expected.responseLimitBytes); }
      catch (error) {
        if (error instanceof OpenAICompatibleProviderError) throw error;
        throw new OpenAICompatibleProviderError("provider_invalid_response");
      }
      let envelope: unknown;
      try { envelope = JSON.parse(raw); }
      catch { throw new OpenAICompatibleProviderError("provider_invalid_response"); }
      const content = extractAssistantContent(envelope);
      if (content === undefined || Buffer.byteLength(content, "utf8") > expected.responseLimitBytes) throw new OpenAICompatibleProviderError("provider_invalid_response");
      return content;
    },
  });
}

export function createOpenAICompatibleSecondOpinionProvider(
  snapshot: ProviderRuntimeSnapshot,
  options: CreateOpenAICompatibleProviderOptions,
): CorrectionAppealSecondOpinionProvider {
  const binding: ResearchRoomSemanticProviderBinding = Object.freeze({
    id: snapshot.config.providerId,
    family: "openai_compatible",
    model: snapshot.config.model,
    baseUrlOrigin: new URL(snapshot.config.baseUrl).origin,
    locality: snapshot.config.locality,
    configGeneration: snapshot.config.generation,
  });
  const endpointIdentityHash = createCorrectionAppealProviderEndpointIdentityHash(binding);
  if (endpointIdentityHash === undefined) throw new OpenAICompatibleProviderError("provider_invalid_request");
  const fetchImplementation = options.fetchImplementation ?? fetch;
  return Object.freeze({
    id: snapshot.config.providerId,
    connectionId: snapshot.config.providerId,
    kind: snapshot.config.locality,
    networkAccess: snapshot.config.locality === "external" ? "external" as const : "loopback" as const,
    endpointIdentityHash,
    binding,
    prepare(request: CorrectionAppealSecondOpinionRequest): CorrectionAppealSecondOpinionProviderInput {
      return secondOpinionPreviewFor(snapshot, binding, request);
    },
    async analyze(
      request: CorrectionAppealSecondOpinionRequest,
      preview: CorrectionAppealSecondOpinionProviderInput,
      { signal }: { readonly signal: AbortSignal },
    ): Promise<string> {
      const expected = secondOpinionPreviewFor(snapshot, binding, request);
      if (!validPreview(preview, expected)) throw new OpenAICompatibleProviderError("provider_invalid_request");
      if (await options.readCurrentGeneration() !== snapshot.config.generation) throw new OpenAICompatibleProviderError("provider_configuration_changed");
      if (signal.aborted) throw new OpenAICompatibleProviderError("provider_aborted");

      const controller = new AbortController();
      const abortState = { timedOut: false, callerAborted: false };
      const propagateAbort = () => { abortState.callerAborted = true; controller.abort(); };
      signal.addEventListener("abort", propagateAbort, { once: true });
      const timer = setTimeout(() => { abortState.timedOut = true; controller.abort(); }, snapshot.config.timeoutMs);
      let response: Response;
      try {
        response = await fetchImplementation(expected.endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(snapshot.apiKey === undefined ? {} : { authorization: `Bearer ${snapshot.apiKey}` }),
          },
          body: expected.requestBody,
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        if (abortState.timedOut) throw new OpenAICompatibleProviderError("provider_timeout");
        if (abortState.callerAborted) throw new OpenAICompatibleProviderError("provider_aborted");
        throw new OpenAICompatibleProviderError("provider_network_failed");
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", propagateAbort);
      }
      if (!response.ok) throw new OpenAICompatibleProviderError("provider_http_error");
      const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") throw new OpenAICompatibleProviderError("provider_invalid_response");
      let raw: string;
      try { raw = await readBoundedBody(response, expected.responseLimitBytes); }
      catch (error) {
        if (error instanceof OpenAICompatibleProviderError) throw error;
        throw new OpenAICompatibleProviderError("provider_invalid_response");
      }
      let envelope: unknown;
      try { envelope = JSON.parse(raw); }
      catch { throw new OpenAICompatibleProviderError("provider_invalid_response"); }
      const content = extractAssistantContent(envelope);
      if (content === undefined || Buffer.byteLength(content, "utf8") > expected.responseLimitBytes) throw new OpenAICompatibleProviderError("provider_invalid_response");
      return content;
    },
  });
}

export interface CreateOpenAICompatibleDeliberationParticipantOptions extends CreateOpenAICompatibleProviderOptions {
  readonly connectionId: string;
  readonly secretRef: string;
}

function deliberationBody(snapshot: ProviderRuntimeSnapshot, request: DeliberationParticipantRequest): string {
  const compiled = compileDeliberationParticipantPrompt(request);
  if (!compiled.ok) throw new OpenAICompatibleProviderError("provider_invalid_request");
  return JSON.stringify({
    model: snapshot.config.model,
    messages: compiled.value.messages,
    temperature: 0,
    stream: false,
    response_format: { type: "json_object" },
    ...(snapshot.config.maxOutputTokens === undefined ? {} : { max_tokens: snapshot.config.maxOutputTokens }),
  });
}

function deliberationPreview(snapshot: ProviderRuntimeSnapshot, request: DeliberationParticipantRequest): DeliberationParticipantProviderInput {
  const requestBody = deliberationBody(snapshot, request);
  return Object.freeze({
    schemaVersion: "1.0.0",
    endpoint: `${snapshot.config.baseUrl}/chat/completions`,
    participantId: request.participant.id,
    participantSnapshotHash: request.participantSnapshotHash,
    requestHash: request.requestHash,
    requestBody,
    requestBodyHash: sha256(requestBody),
    requestBodyBytes: Buffer.byteLength(requestBody, "utf8"),
    responseLimitBytes: request.limits.maxResponseBytes,
    redirectPolicy: "error",
    retryCount: 0,
  });
}

function sameDeliberationPreview(actual: DeliberationParticipantProviderInput, expected: DeliberationParticipantProviderInput): boolean {
  const runtimeRedirectPolicy: unknown = actual.redirectPolicy;
  const runtimeRetryCount: unknown = actual.retryCount;
  return actual.endpoint === expected.endpoint
    && actual.participantId === expected.participantId
    && actual.participantSnapshotHash === expected.participantSnapshotHash
    && actual.requestHash === expected.requestHash
    && actual.requestBody === expected.requestBody
    && actual.requestBodyHash === expected.requestBodyHash
    && actual.requestBodyBytes === expected.requestBodyBytes
    && actual.responseLimitBytes === expected.responseLimitBytes
    && runtimeRedirectPolicy === "error"
    && runtimeRetryCount === 0;
}

export function createOpenAICompatibleDeliberationParticipant(
  snapshot: ProviderRuntimeSnapshot,
  options: CreateOpenAICompatibleDeliberationParticipantOptions,
): DeliberationParticipantProvider {
  const binding: ResearchRoomSemanticProviderBinding = Object.freeze({
    id: snapshot.config.providerId,
    family: "openai_compatible",
    model: snapshot.config.model,
    baseUrlOrigin: new URL(snapshot.config.baseUrl).origin,
    locality: snapshot.config.locality,
    configGeneration: snapshot.config.generation,
  });
  const endpointIdentityHash = sha256(snapshot.config.baseUrl);
  const runtimeIdentityHash = sha256(JSON.stringify({ providerId: snapshot.config.providerId, baseUrl: snapshot.config.baseUrl, model: snapshot.config.model, generation: snapshot.config.generation }));
  const secretRefHash = sha256(options.secretRef);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  return Object.freeze({
    id: snapshot.config.providerId,
    connectionId: options.connectionId,
    kind: snapshot.config.locality,
    networkAccess: snapshot.config.locality === "external" ? "external" as const : "loopback" as const,
    harnessId: "sestina-openai-compatible-http-v1",
    runtimeIdentityHash,
    endpointIdentityHash,
    secretRefHash,
    binding,
    prepare(request: DeliberationParticipantRequest): DeliberationParticipantProviderInput {
      if (request.participant.providerId !== binding.id || request.participant.model !== binding.model || request.participant.configGeneration !== binding.configGeneration) throw new OpenAICompatibleProviderError("provider_invalid_request");
      return deliberationPreview(snapshot, request);
    },
    async analyze(request: DeliberationParticipantRequest, preview: DeliberationParticipantProviderInput, { signal }: { readonly signal: AbortSignal }): Promise<string> {
      const expected = deliberationPreview(snapshot, request);
      if (!sameDeliberationPreview(preview, expected)) throw new OpenAICompatibleProviderError("provider_invalid_request");
      if (await options.readCurrentGeneration() !== snapshot.config.generation) throw new OpenAICompatibleProviderError("provider_configuration_changed");
      if (signal.aborted) throw new OpenAICompatibleProviderError("provider_aborted");
      const controller = new AbortController();
      const abortState = { timedOut: false, callerAborted: false };
      const propagateAbort = () => { abortState.callerAborted = true; controller.abort(); };
      signal.addEventListener("abort", propagateAbort, { once: true });
      const timer = setTimeout(() => { abortState.timedOut = true; controller.abort(); }, snapshot.config.timeoutMs);
      let response: Response;
      try {
        response = await fetchImplementation(expected.endpoint, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", ...(snapshot.apiKey === undefined ? {} : { authorization: `Bearer ${snapshot.apiKey}` }) },
          body: expected.requestBody,
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        if (abortState.timedOut) throw new OpenAICompatibleProviderError("provider_timeout");
        if (abortState.callerAborted) throw new OpenAICompatibleProviderError("provider_aborted");
        throw new OpenAICompatibleProviderError("provider_network_failed");
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", propagateAbort);
      }
      if (!response.ok) throw new OpenAICompatibleProviderError("provider_http_error");
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new OpenAICompatibleProviderError("provider_invalid_response");
      let raw: string;
      try { raw = await readBoundedBody(response, expected.responseLimitBytes); }
      catch (error) { if (error instanceof OpenAICompatibleProviderError) throw error; throw new OpenAICompatibleProviderError("provider_invalid_response"); }
      let envelope: unknown;
      try { envelope = JSON.parse(raw); } catch { throw new OpenAICompatibleProviderError("provider_invalid_response"); }
      const content = extractAssistantContent(envelope);
      if (content === undefined || Buffer.byteLength(content, "utf8") > expected.responseLimitBytes) throw new OpenAICompatibleProviderError("provider_invalid_response");
      return content;
    },
  });
}
