import { createHash, randomBytes } from "node:crypto";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProjectStateBackup,
  createPreUpgradeProjectStateBackup,
  inspectProjectRecovery,
  openSestina,
  ProjectRecoveryConfirmationService,
  coreErr,
  coreOk,
  type BriefProjectionPublisher,
  type ClosedExternalAppPilot,
  type CorrectionAppealSecondOpinionProvider,
  type CoreResult,
  type DeliberationParticipantProvider,
  type ProjectMemoryProviderBinding,
  type ResearchRoomProvider,
  type SestinaCore,
} from "@sestina/core";
import {
  inspectCodexHost,
  runClosedCodexPilotAttempt,
  type ClosedCodexPilotBinding,
  type ClosedCodexPilotKind,
  type ClosedCodexPilotRunResult,
  type CodexHostInspection,
} from "@sestina/mcp";
import { isAppLanguage, type LanguagePreferenceStore } from "./language-preferences.js";
import { createOpenAICompatibleDeliberationParticipant, createOpenAICompatibleProvider, createOpenAICompatibleSecondOpinionProvider, OpenAICompatibleProviderError, testOpenAICompatibleProviderConnection } from "./openai-compatible-provider.js";
import { OPENAI_COMPATIBLE_API_KEY_REF, ProviderSettingsError, SECOND_OPINION_OPENAI_COMPATIBLE_API_KEY_REF, type ProviderConfigurationService, type SaveOpenAICompatibleProviderInput } from "./provider-settings.js";

const LOOPBACK = "127.0.0.1";
const BODY_LIMIT = 65_536;
const BROWSER_BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
const USER = Object.freeze({ kind: "user" as const, actorId: "local-research-owner" });
const CSP = "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'";
function firstExistingRuntimePath(candidates: readonly URL[]): string {
  const resolved = candidates.map((candidate) => resolve(fileURLToPath(candidate)));
  const fallback = resolved[0];
  if (fallback === undefined) throw new Error("At least one runtime path candidate is required.");
  return resolved.find((candidate) => existsSync(candidate)) ?? fallback;
}
const DEFAULT_CLIENT_ASSET_ROOT = firstExistingRuntimePath([new URL("./client", import.meta.url), new URL("../dist/client", import.meta.url)]);
const DEFAULT_MCP_RUNTIME = firstExistingRuntimePath([new URL("./mcp/main.js", import.meta.url), new URL("../dist/mcp/main.js", import.meta.url)]);

export interface ClosedExternalAppHostRuntime {
  readonly evidenceClass: "synthetic_fixture" | "owner_operated_closed_host_observation";
  inspect(): Promise<CodexHostInspection>;
  run(input: {
    readonly kind: ClosedCodexPilotKind;
    readonly projectRoot: string;
    readonly binding: ClosedCodexPilotBinding;
    readonly contextUtf8: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly outputLimitBytes: number;
  }): Promise<ClosedCodexPilotRunResult>;
}

export interface ResearchRoomServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly provider?: ResearchRoomProvider;
  readonly correctionAppealSecondOpinionProvider?: CorrectionAppealSecondOpinionProvider;
  readonly deliberationParticipantProviders?: readonly [DeliberationParticipantProvider, DeliberationParticipantProvider];
  readonly providerTimeoutMs?: number;
  readonly correctionAppealSecondOpinionProviderTimeoutMs?: number;
  readonly deliberationParticipantProviderTimeoutMs?: number;
  readonly directoryPicker?: DirectoryPicker;
  readonly languagePreferenceStore?: LanguagePreferenceStore;
  readonly providerConfigurationService?: ProviderConfigurationService;
  readonly secondOpinionProviderConfigurationService?: ProviderConfigurationService;
  readonly clientAssetRoot?: string;
  readonly closedExternalAppHostRuntime?: ClosedExternalAppHostRuntime;
}

export interface DirectoryPicker {
  pick(signal: AbortSignal): Promise<string | undefined>;
}

export interface RunningResearchRoomServer {
  readonly origin: string;
  readonly host: "127.0.0.1";
  readonly port: number;
  close(): Promise<void>;
}

interface OpenedProject {
  readonly root: string;
  readonly project: { readonly id: string; readonly title: string };
  readonly core: SestinaCore;
  readonly createdBySession: boolean;
}

interface ProjectOpenResult {
  readonly project: { readonly id: string; readonly title: string };
  readonly initialized: boolean;
  readonly setupRequired: boolean;
  readonly recoveryRequired: boolean;
  readonly localOnly: true;
  readonly pathPersisted: false;
  readonly directoryScanPerformed: false;
}

interface PendingProjectInitialization {
  readonly root: string;
  readonly title: string;
  readonly confirmationNonce: string;
}

class HttpProblem extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function text(value: unknown, maxBytes: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && Buffer.byteLength(normalized, "utf8") <= maxBytes ? normalized : undefined;
}
function stableConfigHash(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!isRecord(input)) return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
  };
  return createHash("sha256").update(JSON.stringify(normalize(value)), "utf8").digest("hex");
}
function resultValue<T>(result: CoreResult<T>): T {
  if (result.ok) return result.value;
  const status = result.error.code === "not_found" ? 404
    : ["stale_state", "state_conflict", "storage_corrupt", "confirmation_expired", "confirmation_replayed", "confirmation_binding_mismatch"].includes(result.error.code) ? 409
      : result.error.code === "storage_readonly" ? 403
        : ["infrastructure_failure", "projection_write_failure", "storage_busy", "storage_unavailable"].includes(result.error.code) ? 503
          : 400;
  throw new HttpProblem(status, result.error.code, result.error.message);
}

function authorityResultValue<T>(result: CoreResult<T>): T {
  if (!result.ok && result.error.code === "state_conflict") throw new HttpProblem(409, "invalid_transition", "The authority transition is not legal for the current object state.");
  return resultValue(result);
}

function workspaceResultValue<T>(result: CoreResult<T>): T {
  return resultValue(result);
}

function workspaceListRequest(url: URL): { readonly limit: number; readonly cursor?: string; readonly status?: string; readonly query?: string; readonly source?: string; readonly scope?: string; readonly active?: boolean; readonly referencedByCurrentBrief?: boolean; readonly issueKind?: string; readonly relevance?: "current_brief"; readonly unresolved?: boolean; readonly disposition?: string; readonly providerStatus?: string } {
  const allowed = new Set(["active", "cursor", "disposition", "issueKind", "limit", "providerStatus", "query", "referencedByCurrentBrief", "relevance", "scope", "source", "status", "unresolved"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new HttpProblem(400, "invalid_input", "The list query is invalid.");
  const limitRaw = url.searchParams.get("limit") ?? "50";
  if (!/^\d{1,3}$/u.test(limitRaw)) throw new HttpProblem(400, "invalid_input", "The list limit is invalid.");
  const limit = Number(limitRaw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new HttpProblem(400, "invalid_input", "The list limit is invalid.");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const query = url.searchParams.get("query") ?? undefined;
  const short = (name: string): string | undefined => { const value = url.searchParams.get(name) ?? undefined; if (value !== undefined && (value.length === 0 || value.length > 128)) throw new HttpProblem(400, "invalid_input", "The list query is invalid."); return value; };
  const bool = (name: string): boolean | undefined => { const value = url.searchParams.get(name); if (value === null) return undefined; if (value === "true") return true; if (value === "false") return false; throw new HttpProblem(400, "invalid_input", "The list boolean filter is invalid."); };
  const source = short("source"); const scope = short("scope"); const issueKind = short("issueKind"); const relevanceValue = short("relevance"); const disposition = short("disposition"); const providerStatus = short("providerStatus");
  const active = bool("active"); const referencedByCurrentBrief = bool("referencedByCurrentBrief"); const unresolved = bool("unresolved");
  if (relevanceValue !== undefined && relevanceValue !== "current_brief") throw new HttpProblem(400, "invalid_input", "The Issue relevance filter is invalid.");
  if ((cursor !== undefined && (cursor.length === 0 || cursor.length > 8192)) || (status !== undefined && (status.length === 0 || status.length > 64)) || (query !== undefined && Buffer.byteLength(query, "utf8") > 512)) throw new HttpProblem(400, "invalid_input", "The list query is invalid.");
  return { limit, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}), ...(query !== undefined ? { query } : {}), ...(source ? { source } : {}), ...(scope ? { scope } : {}), ...(active === undefined ? {} : { active }), ...(referencedByCurrentBrief === undefined ? {} : { referencedByCurrentBrief }), ...(issueKind ? { issueKind } : {}), ...(relevanceValue === "current_brief" ? { relevance: relevanceValue } : {}), ...(unresolved === undefined ? {} : { unresolved }), ...(disposition ? { disposition } : {}), ...(providerStatus ? { providerStatus } : {}) };
}

function confirmedCommand(input: unknown, commandType: string, keys: readonly string[], projectId: string): Record<string, unknown> {
  if (!isRecord(input) || !hasExactKeys(input, keys) || input.commandType !== commandType) throw new HttpProblem(400, "invalid_input", "The explicit command is invalid.");
  if (input.projectId !== projectId) throw new HttpProblem(409, "cross_project_reference", "The command is bound to another project.");
  if (input.confirmed !== true) throw new HttpProblem(400, "user_confirmation_required", "The command requires explicit user confirmation.");
  if (text(input.reason, 4_096) === undefined) throw new HttpProblem(400, "invalid_input", "The command reason is required.");
  if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) throw new HttpProblem(400, "invalid_input", "The expected version is invalid.");
  return input;
}
function confirmedProjectCommand(input: unknown, commandType: string, keys: readonly string[], projectId: string): Record<string, unknown> {
  if (!isRecord(input) || !hasExactKeys(input, keys) || input.commandType !== commandType) throw new HttpProblem(400, "invalid_input", "The explicit project command is invalid.");
  if (input.projectId !== projectId) throw new HttpProblem(409, "cross_project_reference", "The command is bound to another project.");
  if (input.confirmed !== true) throw new HttpProblem(400, "user_confirmation_required", "The command requires explicit user confirmation.");
  return input;
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}
function asset(response: ServerResponse, contentType: string, body: string | Uint8Array, immutable = false): void {
  response.writeHead(200, { "content-type": contentType, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store", "content-security-policy": CSP, "cross-origin-opener-policy": "same-origin", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY" });
  response.end(body);
}

function clientContentType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".woff2": return "font/woff2";
    default: return undefined;
  }
}
function hostAllowed(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const host = raw.toLowerCase().split(":")[0];
  return host === "127.0.0.1" || host === "localhost";
}
type EntryKind = "missing" | "file" | "directory" | "other";
async function entryKind(path: string): Promise<EntryKind> {
  try {
    const value = await lstat(path);
    if (value.isSymbolicLink()) return "other";
    if (value.isFile()) return "file";
    if (value.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    return isRecord(error) && error.code === "ENOENT" ? "missing" : "other";
  }
}
function renderDraft(projectId: string, title: string): string {
  return [
    "schemaVersion: 1",
    "status: draft",
    `projectId: ${projectId}`,
    `title: ${JSON.stringify(title)}`,
    "projectQuestion: \"\"",
    "currentStage: question_formulation",
    "currentTask: \"\"",
    "targetArtifacts: []",
    "fixedDecisions: []",
    "allowedChanges: []",
    "forbiddenChanges: []",
    "expectedDeltas: []",
    "evidenceBoundaries: []",
    "explicitNonGoals: []",
    "",
  ].join("\n");
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  let bytes = 0; const chunks: Uint8Array[] = [];
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); bytes += chunk.byteLength;
    if (bytes > BODY_LIMIT) throw new HttpProblem(413, "request_too_large", "The request exceeds the local safety limit.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpProblem(400, "invalid_json", "The request body is not valid JSON."); }
}
function publicError(error: unknown): { readonly status: number; readonly body: unknown } {
  if (error instanceof HttpProblem) return { status: error.status, body: { ok: false, error: { code: error.code, message: error.message } } };
  return { status: 500, body: { ok: false, error: { code: "internal_error", message: "The local Research Room could not complete the request." } } };
}

export function createProductionClosedExternalAppHostRuntime(): ClosedExternalAppHostRuntime {
  return Object.freeze({
    evidenceClass: "owner_operated_closed_host_observation" as const,
    inspect: async () => await inspectCodexHost({}),
    run: async (input: Parameters<ClosedExternalAppHostRuntime["run"]>[0]) => await runClosedCodexPilotAttempt({
      ...input,
      mcpLaunch: { command: process.execPath, args: [DEFAULT_MCP_RUNTIME], cwd: dirname(DEFAULT_MCP_RUNTIME) },
    }),
  });
}

export class ResearchRoomHttpApplication {
  readonly sessionToken = randomBytes(32).toString("hex");
  #opened: OpenedProject | undefined;
  #recoveryRoot: string | undefined;
  readonly #recoveryConfirmations = new ProjectRecoveryConfirmationService();
  #recoveryBusy = false;
  #pickerAbort: AbortController | undefined;
  #pendingInitialization: PendingProjectInitialization | undefined;
  readonly #pilotAbort = new Map<string, AbortController>();

  constructor(
    private readonly provider?: ResearchRoomProvider,
    private readonly correctionAppealSecondOpinionProvider?: CorrectionAppealSecondOpinionProvider,
    private readonly deliberationParticipantProviders?: readonly [DeliberationParticipantProvider, DeliberationParticipantProvider],
    private readonly providerTimeoutMs = 15_000,
    private readonly correctionAppealSecondOpinionProviderTimeoutMs = 15_000,
    private readonly deliberationParticipantProviderTimeoutMs = 15_000,
    private readonly directoryPicker?: DirectoryPicker,
    private readonly languagePreferenceStore?: LanguagePreferenceStore,
    private readonly providerConfigurationService?: ProviderConfigurationService,
    private readonly secondOpinionProviderConfigurationService?: ProviderConfigurationService,
    private readonly clientAssetRoot = DEFAULT_CLIENT_ASSET_ROOT,
    private readonly closedExternalAppHostRuntime: ClosedExternalAppHostRuntime = createProductionClosedExternalAppHostRuntime(),
  ) {}

  close(): void {
    this.#pickerAbort?.abort(); this.#pickerAbort = undefined;
    for (const controller of this.#pilotAbort.values()) controller.abort();
    this.#pilotAbort.clear(); this.#pendingInitialization = undefined; this.#opened?.core.close(); this.#opened = undefined; this.#recoveryRoot = undefined;
  }

  private requireOpened(): OpenedProject {
    if (this.#opened === undefined) throw new HttpProblem(409, "project_not_open", "Open an initialized Sestina project first.");
    return this.#opened;
  }

  private authorize(request: IncomingMessage): void {
    if (request.headers["x-sestina-session"] !== this.sessionToken) throw new HttpProblem(403, "explicit_action_required", "This action requires the active local session.");
  }

  private requireRecoveryRoot(): string {
    const root = this.#opened?.root ?? this.#recoveryRoot;
    if (root === undefined) throw new HttpProblem(409, "project_not_open", "Open or select a Sestina project before using recovery.");
    return root;
  }

  private async closeRunAndReopenRecovery<T>(operation: (root: string) => Promise<CoreResult<T>>): Promise<{ readonly outcome: CoreResult<T>; readonly reopened: ProjectOpenResult }> {
    const root = this.requireRecoveryRoot();
    if (this.#recoveryBusy) throw new HttpProblem(409, "storage_busy", "Another recovery operation is still in progress.");
    this.#recoveryBusy = true;
    this.#opened?.core.close();
    this.#opened = undefined;
    this.#recoveryRoot = root;
    let outcome: CoreResult<T> | undefined;
    let operationError: unknown;
    try { outcome = await operation(root); }
    catch (error) { operationError = error; }
    let reopened: ProjectOpenResult;
    try { reopened = await this.openProject({ projectPath: root, initializeIfNeeded: false }); }
    catch {
      this.#recoveryRoot = root;
      this.#recoveryBusy = false;
      throw new HttpProblem(503, "project_reopen_failed", "Recovery finished, but the project could not be reopened safely. Retry opening the same local project.");
    }
    this.#recoveryBusy = false;
    if (operationError !== undefined) throw operationError instanceof Error ? operationError : new Error("The recovery operation failed.");
    if (outcome === undefined) throw new HttpProblem(500, "internal_error", "The recovery operation produced no result.");
    return { outcome, reopened };
  }

  private async recoveryStatus(): Promise<unknown> {
    return resultValue(await inspectProjectRecovery({ projectRoot: this.requireRecoveryRoot() }));
  }

  private async createRecoveryBackup(): Promise<unknown> {
    const status = resultValue(await inspectProjectRecovery({ projectRoot: this.requireRecoveryRoot() }));
    if (status.currentState !== "healthy") throw new HttpProblem(409, "state_conflict", "A new backup can be created only from a healthy, matched project state.");
    return resultValue(await createProjectStateBackup({ projectRoot: this.requireRecoveryRoot() }));
  }

  private async prepareRecoveryRestore(input: unknown): Promise<unknown> {
    if (!isRecord(input) || !hasExactKeys(input, ["backupId"]) || text(input.backupId, 256) === undefined) throw new HttpProblem(400, "invalid_input", "Choose one verified managed backup.");
    const backupId = String(input.backupId);
    const run = await this.closeRunAndReopenRecovery((root) => this.#recoveryConfirmations.prepare({ projectRoot: root, backupId, sessionBinding: this.sessionToken }));
    return resultValue(run.outcome);
  }

  private async executeRecoveryRestore(input: unknown): Promise<unknown> {
    if (!isRecord(input)
      || !hasExactKeys(input, ["backupId", "confirmationNonce", "confirmed", "expectedStateBinding"])
      || input.confirmed !== true
      || text(input.backupId, 256) === undefined
      || text(input.confirmationNonce, 256) === undefined
      || text(input.expectedStateBinding, 256) === undefined) {
      throw new HttpProblem(400, "user_confirmation_required", "Restoring requires the exact preview binding and explicit confirmation.");
    }
    const run = await this.closeRunAndReopenRecovery((root) => this.#recoveryConfirmations.execute({
      projectRoot: root,
      backupId: String(input.backupId),
      sessionBinding: this.sessionToken,
      confirmed: true,
      confirmationNonce: String(input.confirmationNonce),
      expectedStateBinding: String(input.expectedStateBinding),
    }));
    const restored = resultValue(run.outcome);
    if (run.reopened.recoveryRequired) throw new HttpProblem(503, "project_reopen_failed", "The restored project did not reopen into a healthy Research Room.");
    return Object.freeze({ ...restored, reopened: true as const, project: run.reopened.project });
  }

  private async readLanguagePreference(): Promise<"zh-CN" | "en" | undefined> {
    if (this.languagePreferenceStore === undefined) return undefined;
    try { return await this.languagePreferenceStore.readLanguage(); }
    catch { throw new HttpProblem(503, "language_preference_unavailable", "The local language preference is unavailable."); }
  }

  private async requireLanguagePreference(): Promise<"zh-CN" | "en"> {
    const language = await this.readLanguagePreference();
    if (language === undefined) throw new HttpProblem(409, "language_preference_required", "Choose Chinese or English before continuing.");
    return language;
  }

  private async setLanguagePreference(input: unknown): Promise<{ readonly language: "zh-CN" | "en" }> {
    if (this.languagePreferenceStore === undefined) throw new HttpProblem(503, "language_preference_unavailable", "The local language preference is unavailable.");
    if (!isRecord(input) || Object.keys(input).length !== 1 || !isAppLanguage(input.language)) throw new HttpProblem(400, "invalid_language", "Choose either zh-CN or en.");
    try { await this.languagePreferenceStore.writeLanguage(input.language); }
    catch { throw new HttpProblem(503, "language_preference_write_failed", "The language choice could not be saved locally."); }
    return { language: input.language };
  }

  private providerProblem(error: unknown): never {
    if (error instanceof ProviderSettingsError) {
      const status = error.code === "invalid_provider_config" ? 400 : error.code === "provider_config_corrupt" ? 409 : 503;
      throw new HttpProblem(status, error.code, error.message);
    }
    throw error;
  }

  private async configuredProvider(): Promise<ResearchRoomProvider | undefined> {
    if (this.provider !== undefined) return this.provider;
    if (this.providerConfigurationService === undefined) return undefined;
    try {
      const snapshot = await this.providerConfigurationService.loadRuntimeSnapshot();
      return snapshot === undefined ? undefined : createOpenAICompatibleProvider(snapshot, {
        readCurrentGeneration: () => this.providerConfigurationService?.currentGeneration() ?? Promise.resolve(undefined),
      });
    } catch (error) { return this.providerProblem(error); }
  }

  private async configuredSecondOpinionProvider(): Promise<CorrectionAppealSecondOpinionProvider | undefined> {
    if (this.correctionAppealSecondOpinionProvider !== undefined) return this.correctionAppealSecondOpinionProvider;
    if (this.secondOpinionProviderConfigurationService === undefined) return undefined;
    try {
      const snapshot = await this.secondOpinionProviderConfigurationService.loadRuntimeSnapshot();
      return snapshot === undefined ? undefined : createOpenAICompatibleSecondOpinionProvider(snapshot, {
        readCurrentGeneration: () => this.secondOpinionProviderConfigurationService?.currentGeneration() ?? Promise.resolve(undefined),
      });
    } catch (error) { return this.providerProblem(error); }
  }

  private async configuredDeliberationParticipants(): Promise<readonly [DeliberationParticipantProvider, DeliberationParticipantProvider] | undefined> {
    if (this.deliberationParticipantProviders !== undefined) return this.deliberationParticipantProviders;
    if (this.providerConfigurationService === undefined || this.secondOpinionProviderConfigurationService === undefined) return undefined;
    try {
      const [primary, secondary] = await Promise.all([this.providerConfigurationService.loadRuntimeSnapshot(), this.secondOpinionProviderConfigurationService.loadRuntimeSnapshot()]);
      if (primary === undefined || secondary === undefined) return undefined;
      return Object.freeze([
        createOpenAICompatibleDeliberationParticipant(primary, { connectionId: `primary:${primary.config.providerId}`, secretRef: OPENAI_COMPATIBLE_API_KEY_REF, readCurrentGeneration: () => this.providerConfigurationService?.currentGeneration() ?? Promise.resolve(undefined) }),
        createOpenAICompatibleDeliberationParticipant(secondary, { connectionId: `second-opinion:${secondary.config.providerId}`, secretRef: SECOND_OPINION_OPENAI_COMPATIBLE_API_KEY_REF, readCurrentGeneration: () => this.secondOpinionProviderConfigurationService?.currentGeneration() ?? Promise.resolve(undefined) }),
      ]);
    } catch (error) { return this.providerProblem(error); }
  }

  private async providerStatus(): Promise<unknown> {
    if (this.providerConfigurationService === undefined) return { mode: this.provider === undefined ? "offline_ledger" : "configured", injected: this.provider !== undefined };
    try { return await this.providerConfigurationService.status(); }
    catch (error) { return this.providerProblem(error); }
  }

  private async projectMemoryProviderBinding(): Promise<ProjectMemoryProviderBinding> {
    if (this.providerConfigurationService !== undefined) {
      const status = await this.providerStatus();
      if (isRecord(status) && status.mode === "configured" && isRecord(status.config)) {
        const providerId = text(status.config.providerId, 128);
        const locality = status.config.locality;
        if (providerId !== undefined && (locality === "local" || locality === "external")) {
          return Object.freeze({
            id: providerId,
            kind: locality,
            configHash: stableConfigHash(status.config),
            networkRequired: locality === "external",
          });
        }
      }
    }
    if (this.provider !== undefined) {
      return Object.freeze({
        id: this.provider.id,
        kind: this.provider.kind,
        configHash: stableConfigHash({ id: this.provider.id, kind: this.provider.kind, networkAccess: this.provider.networkAccess, binding: this.provider.binding }),
        networkRequired: this.provider.networkAccess === "external",
      });
    }
    return Object.freeze({ id: "none", kind: "none", configHash: stableConfigHash({ mode: "offline_ledger" }), networkRequired: false });
  }

  private async saveProvider(input: unknown): Promise<unknown> {
    if (this.providerConfigurationService === undefined) throw new HttpProblem(503, "provider_settings_unavailable", "Provider settings are unavailable.");
    try {
      await this.providerConfigurationService.save(input as SaveOpenAICompatibleProviderInput);
      return { ...(await this.providerConfigurationService.status()), projectReopenRequired: this.#opened !== undefined };
    } catch (error) { return this.providerProblem(error); }
  }

  private async deleteProviderConfig(): Promise<unknown> {
    if (this.providerConfigurationService === undefined) throw new HttpProblem(503, "provider_settings_unavailable", "Provider settings are unavailable.");
    try { await this.providerConfigurationService.deleteConfig(); return { ...(await this.providerConfigurationService.status()), projectReopenRequired: this.#opened !== undefined }; }
    catch (error) { return this.providerProblem(error); }
  }

  private async deleteProviderSecret(): Promise<unknown> {
    if (this.providerConfigurationService === undefined) throw new HttpProblem(503, "provider_settings_unavailable", "Provider settings are unavailable.");
    try { await this.providerConfigurationService.deleteSecret(); return { ...(await this.providerConfigurationService.status()), projectReopenRequired: this.#opened !== undefined }; }
    catch (error) { return this.providerProblem(error); }
  }

  private async secondOpinionProviderStatus(): Promise<unknown> {
    if (this.secondOpinionProviderConfigurationService === undefined) return { mode: this.correctionAppealSecondOpinionProvider === undefined ? "offline_ledger" : "configured", injected: this.correctionAppealSecondOpinionProvider !== undefined };
    try { return await this.secondOpinionProviderConfigurationService.status(); }
    catch (error) { return this.providerProblem(error); }
  }

  private async saveSecondOpinionProvider(input: unknown): Promise<unknown> {
    if (this.secondOpinionProviderConfigurationService === undefined) throw new HttpProblem(503, "provider_settings_unavailable", "Second-opinion Provider settings are unavailable.");
    try {
      await this.secondOpinionProviderConfigurationService.save(input as SaveOpenAICompatibleProviderInput);
      return { ...(await this.secondOpinionProviderConfigurationService.status()), projectReopenRequired: this.#opened !== undefined };
    } catch (error) { return this.providerProblem(error); }
  }

  private async deleteSecondOpinionProviderConfig(): Promise<unknown> {
    if (this.secondOpinionProviderConfigurationService === undefined) throw new HttpProblem(503, "provider_settings_unavailable", "Second-opinion Provider settings are unavailable.");
    try { await this.secondOpinionProviderConfigurationService.deleteConfig(); return { ...(await this.secondOpinionProviderConfigurationService.status()), projectReopenRequired: this.#opened !== undefined }; }
    catch (error) { return this.providerProblem(error); }
  }

  private async deleteSecondOpinionProviderSecret(): Promise<unknown> {
    if (this.secondOpinionProviderConfigurationService === undefined) throw new HttpProblem(503, "provider_settings_unavailable", "Second-opinion Provider settings are unavailable.");
    try { await this.secondOpinionProviderConfigurationService.deleteSecret(); return { ...(await this.secondOpinionProviderConfigurationService.status()), projectReopenRequired: this.#opened !== undefined }; }
    catch (error) { return this.providerProblem(error); }
  }

  private async testSecondOpinionProvider(): Promise<unknown> {
    if (this.secondOpinionProviderConfigurationService === undefined) throw new HttpProblem(503, "provider_settings_unavailable", "Second-opinion Provider settings are unavailable.");
    try {
      const snapshot = await this.secondOpinionProviderConfigurationService.loadRuntimeSnapshot();
      if (snapshot === undefined) throw new HttpProblem(409, "provider_not_configured", "Configure the independent second-opinion Provider before testing it.");
      return await testOpenAICompatibleProviderConnection(snapshot);
    } catch (error) {
      if (error instanceof OpenAICompatibleProviderError) throw new HttpProblem(503, error.code, error.message);
      return this.providerProblem(error);
    }
  }

  private async initializeProject(root: string, title: string): Promise<OpenedProject> {
    const stateDirectory = join(root, ".sestina");
    const databasePath = join(stateDirectory, "state.sqlite");
    let core: SestinaCore | undefined;
    let createdStateDirectory = false;
    try {
      await mkdir(stateDirectory);
      createdStateDirectory = true;
      const provider = await this.configuredProvider();
      const secondOpinionProvider = await this.configuredSecondOpinionProvider();
      const deliberationProviders = await this.configuredDeliberationParticipants();
      core = resultValue(await openSestina({
        databasePath,
        ...(provider ? { researchRoomProvider: provider } : {}),
        ...(secondOpinionProvider ? { correctionAppealSecondOpinionProvider: secondOpinionProvider } : {}),
        ...(deliberationProviders ? { deliberationParticipantProviders: deliberationProviders } : {}),
        researchRoomProviderTimeoutMs: this.providerTimeoutMs,
        correctionAppealSecondOpinionProviderTimeoutMs: this.correctionAppealSecondOpinionProviderTimeoutMs,
        deliberationParticipantProviderTimeoutMs: this.deliberationParticipantProviderTimeoutMs,
      }));
      const project = resultValue(core.initializeProject({ title, rootPath: ".", actor: USER }));
      await writeFile(join(stateDirectory, "research-brief.yaml"), renderDraft(project.id, title), { encoding: "utf8", flag: "wx" });
      await writeFile(join(stateDirectory, "gitignore-suggestion.txt"), ".sestina/\n", { encoding: "utf8", flag: "wx" });
      return { root, project: { id: project.id, title: project.title }, core, createdBySession: true };
    } catch (error) {
      core?.close();
      if (createdStateDirectory) await rm(stateDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async openProject(input: unknown): Promise<ProjectOpenResult> {
    if (!isRecord(input)) throw new HttpProblem(400, "invalid_input", "Choose a local project directory.");
    const projectPath = text(input.projectPath, 16_384);
    if (projectPath === undefined) throw new HttpProblem(400, "invalid_input", "Choose a local project directory.");
    let root: string;
    try { root = await realpath(projectPath); } catch { throw new HttpProblem(404, "project_not_found", "The selected directory is unavailable."); }
    if (await entryKind(root) !== "directory") throw new HttpProblem(400, "invalid_input", "Choose a local project directory.");
    const stateDirectory = join(root, ".sestina");
    const databasePath = join(stateDirectory, "state.sqlite");
    const briefPath = join(stateDirectory, "research-brief.yaml");
    const [stateKind, databaseKind, briefKind] = await Promise.all([entryKind(stateDirectory), entryKind(databasePath), entryKind(briefPath)]);
    let next: OpenedProject;
    let initialized = false;
    if (stateKind === "directory" && databaseKind === "file" && briefKind === "file") {
      const upgradePreflight = await inspectProjectRecovery({ projectRoot: root });
      if (upgradePreflight.ok) {
        const schema = upgradePreflight.value.schema;
        const unsupported = schema.status === "too_new" || schema.status === "too_old" || schema.status === "migration_failed";
        const supportedUpgrade = schema.status === "recognized" && schema.version !== undefined && schema.version < schema.supportedVersion;
        if (unsupported || (supportedUpgrade && upgradePreflight.value.currentState !== "healthy")) {
          this.#opened?.core.close(); this.#opened = undefined; this.#recoveryRoot = root;
          return { project: { id: upgradePreflight.value.projectId ?? "recovery_required", title: basename(root) }, initialized: false, setupRequired: false, recoveryRequired: true, localOnly: true, pathPersisted: false, directoryScanPerformed: false };
        }
        if (supportedUpgrade) {
          const safetyBundle = resultValue(await createPreUpgradeProjectStateBackup({ projectRoot: root }));
          if (safetyBundle.databaseSchemaVersion !== schema.version || safetyBundle.kind !== "pre_upgrade") throw new HttpProblem(503, "pre_upgrade_backup_failed", "The complete pre-upgrade safety bundle could not be verified.");
        }
      }
      const provider = await this.configuredProvider();
      const secondOpinionProvider = await this.configuredSecondOpinionProvider();
      const deliberationProviders = await this.configuredDeliberationParticipants();
      const openedCore = await openSestina({
        databasePath,
        ...(provider ? { researchRoomProvider: provider } : {}),
        ...(secondOpinionProvider ? { correctionAppealSecondOpinionProvider: secondOpinionProvider } : {}),
        ...(deliberationProviders ? { deliberationParticipantProviders: deliberationProviders } : {}),
        researchRoomProviderTimeoutMs: this.providerTimeoutMs,
        correctionAppealSecondOpinionProviderTimeoutMs: this.correctionAppealSecondOpinionProviderTimeoutMs,
        deliberationParticipantProviderTimeoutMs: this.deliberationParticipantProviderTimeoutMs,
      });
      if (!openedCore.ok) {
        const recovery = await inspectProjectRecovery({ projectRoot: root });
        if (recovery.ok) {
          this.#opened?.core.close();
          this.#opened = undefined;
          this.#recoveryRoot = root;
          return {
            project: { id: recovery.value.projectId ?? "recovery_required", title: basename(root) },
            initialized: false,
            setupRequired: false,
            recoveryRequired: true,
            localOnly: true,
            pathPersisted: false,
            directoryScanPerformed: false,
          };
        }
        resultValue(openedCore);
        throw new HttpProblem(409, "state_conflict", "The selected project cannot be opened safely.");
      }
      const core = openedCore.value;
      const projects = resultValue(core.listProjects());
      if (projects.length !== 1 || projects[0] === undefined) { core.close(); throw new HttpProblem(409, "state_conflict", "The selected project binding is inconsistent."); }
      next = { root, project: { id: projects[0].id, title: projects[0].title }, core, createdBySession: false };
    } else if (stateKind === "missing" && databaseKind === "missing" && briefKind === "missing") {
      if (input.initializeIfNeeded !== true) throw new HttpProblem(409, "initialization_confirmation_required", "Opening this directory can create a local .sestina project after explicit confirmation.");
      const title = text(input.projectTitle, 512) ?? basename(root);
      next = await this.initializeProject(root, title);
      initialized = true;
    } else {
      throw new HttpProblem(409, "state_conflict", "A foreign or partial .sestina directory was preserved.");
    }
    const brief = resultValue(next.core.getBriefState(next.project.id));
    this.#opened?.core.close();
    this.#opened = next;
    this.#recoveryRoot = undefined;
    return { project: next.project, initialized, setupRequired: brief === undefined, recoveryRequired: false, localOnly: true, pathPersisted: false, directoryScanPerformed: false };
  }

  private async pickDirectory(): Promise<string | undefined> {
    if (this.directoryPicker === undefined) throw new HttpProblem(501, "directory_picker_unavailable", "The system folder picker is unavailable. Use manual path entry instead.");
    if (this.#pickerAbort !== undefined) throw new HttpProblem(409, "directory_picker_busy", "A system folder picker is already open.");
    const controller = new AbortController(); this.#pickerAbort = controller;
    try {
      try { return await this.directoryPicker.pick(controller.signal); }
      catch {
        if (controller.signal.aborted) throw new HttpProblem(409, "directory_picker_cancelled", "The system folder picker was cancelled. Use manual path entry if needed.");
        throw new HttpProblem(502, "directory_picker_failed", "The system folder picker could not be opened. Use manual path entry instead.");
      }
    } finally {
      if (this.#pickerAbort === controller) this.#pickerAbort = undefined;
    }
  }

  private cancelDirectoryPicker(): { readonly cancelRequested: boolean } {
    if (this.#pickerAbort === undefined) return { cancelRequested: false };
    this.#pickerAbort.abort();
    return { cancelRequested: true };
  }

  private async selectDirectory(): Promise<{ readonly selected: false } | ({ readonly selected: true } & ProjectOpenResult)> {
    const selected = await this.pickDirectory();
    if (selected === undefined) return { selected: false };
    return { selected: true, ...await this.openProject({ projectPath: selected, initializeIfNeeded: true }) };
  }

  private async previewSelectedDirectory(): Promise<unknown> {
    const selected = await this.pickDirectory();
    if (selected === undefined) { this.#pendingInitialization = undefined; return { selected: false }; }
    let root: string;
    try { root = await realpath(selected); } catch { throw new HttpProblem(404, "project_not_found", "The selected directory is unavailable."); }
    if (await entryKind(root) !== "directory") throw new HttpProblem(400, "invalid_input", "Choose a local project directory.");
    const stateDirectory = join(root, ".sestina");
    const [stateKind, databaseKind, briefKind] = await Promise.all([
      entryKind(stateDirectory),
      entryKind(join(stateDirectory, "state.sqlite")),
      entryKind(join(stateDirectory, "research-brief.yaml")),
    ]);
    if (stateKind === "directory" && databaseKind === "file" && briefKind === "file") {
      this.#pendingInitialization = undefined;
      return { selected: true, initializationRequired: false, ...await this.openProject({ projectPath: root, initializeIfNeeded: false }) };
    }
    if (stateKind === "missing" && databaseKind === "missing" && briefKind === "missing") {
      const pending = { root, title: basename(root), confirmationNonce: randomBytes(32).toString("hex") };
      this.#pendingInitialization = pending;
      return {
        selected: true,
        initializationRequired: true,
        projectTitle: pending.title,
        confirmationNonce: pending.confirmationNonce,
        localOnly: true,
        pathPersisted: false,
        directoryScanPerformed: false,
        writesPerformed: false,
        creates: [".sestina/state.sqlite", ".sestina/research-brief.yaml", ".sestina/gitignore-suggestion.txt"],
      };
    }
    this.#pendingInitialization = undefined;
    throw new HttpProblem(409, "state_conflict", "A foreign or partial .sestina directory was preserved.");
  }

  private async initializeSelectedDirectory(input: unknown): Promise<ProjectOpenResult> {
    if (!isRecord(input)) throw new HttpProblem(400, "invalid_input", "The initialization confirmation is invalid.");
    const nonce = text(input.confirmationNonce, 256);
    const pending = this.#pendingInitialization;
    if (nonce === undefined || nonce !== pending?.confirmationNonce) throw new HttpProblem(409, "initialization_confirmation_invalid", "Select the folder again before initializing it.");
    this.#pendingInitialization = undefined;
    const next = await this.initializeProject(pending.root, pending.title);
    const brief = resultValue(next.core.getBriefState(next.project.id));
    this.#opened?.core.close();
    this.#opened = next;
    this.#recoveryRoot = undefined;
    return { project: next.project, initialized: true, setupRequired: brief === undefined, recoveryRequired: false, localOnly: true, pathPersisted: false, directoryScanPerformed: false };
  }

  private async activateInitialBrief(input: unknown): Promise<unknown> {
    if (!isRecord(input)) throw new HttpProblem(400, "invalid_input", "Enter the initial research question and current task.");
    const projectQuestion = text(input.projectQuestion, 4_096);
    const currentTask = text(input.currentTask, 4_096);
    if (projectQuestion === undefined || currentTask === undefined) throw new HttpProblem(400, "invalid_input", "Enter the initial research question and current task.");
    const opened = this.requireOpened();
    const existing = resultValue(opened.core.getBriefState(opened.project.id));
    if (existing !== undefined) throw new HttpProblem(409, "state_conflict", "The initial Research Brief is already active.");
    const brief = resultValue(opened.core.activateBrief({
      projectId: opened.project.id,
      actor: USER,
      projectQuestion,
      currentStage: "question_formulation",
      currentTask,
      targetArtifacts: [],
      fixedDecisions: [],
      allowedChanges: [],
      forbiddenChanges: [],
      expectedDeltas: [{ statement: currentTask, scope: { target: { kind: "project_path", relativePath: "." }, operations: ["add"] } }],
      evidenceBoundaries: [],
      explicitNonGoals: [],
    }));
    const projection = resultValue(opened.core.getBriefState(opened.project.id));
    if (projection?.brief.id !== brief.id) throw new HttpProblem(500, "infrastructure_failure", "The initial Research Brief projection is unavailable.");
    const target = join(opened.root, ".sestina", "research-brief.yaml");
    const staged = join(opened.root, ".sestina", `research-brief.${randomBytes(8).toString("hex")}.tmp`);
    try {
      await writeFile(staged, projection.yaml, { encoding: "utf8", flag: "wx" });
      await rename(staged, target);
    } catch (error) {
      await rm(staged, { force: true }).catch(() => undefined);
      if (opened.createdBySession) {
        opened.core.close(); this.#opened = undefined;
        await rm(join(opened.root, ".sestina"), { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
    return resultValue(opened.core.getResearchRoomState(opened.project.id));
  }

  private briefProjectionPublisher(opened: OpenedProject): BriefProjectionPublisher {
    return (yaml) => {
      const target = join(opened.root, ".sestina", "research-brief.yaml");
      const suffix = randomBytes(12).toString("hex");
      const staged = join(opened.root, ".sestina", `.research-brief.${suffix}.tmp`);
      const backup = join(opened.root, ".sestina", `.research-brief.${suffix}.bak`);
      let targetMoved = false;
      let stagedPublished = false;
      try {
        if (!existsSync(target)) return coreErr("projection_write_failure");
        writeFileSync(staged, yaml, { encoding: "utf8", flag: "wx" });
        renameSync(target, backup); targetMoved = true;
        renameSync(staged, target); stagedPublished = true;
        return coreOk(Object.freeze({
          rollback: () => {
            if (stagedPublished && existsSync(target)) rmSync(target, { force: true });
            if (targetMoved && existsSync(backup)) renameSync(backup, target);
            if (existsSync(staged)) rmSync(staged, { force: true });
          },
          finalize: () => {
            if (existsSync(backup)) rmSync(backup, { force: true });
            if (existsSync(staged)) rmSync(staged, { force: true });
          },
        }));
      } catch {
        try {
          if (!stagedPublished && targetMoved && !existsSync(target) && existsSync(backup)) renameSync(backup, target);
          if (existsSync(staged)) rmSync(staged, { force: true });
        } catch { /* Recovery is reported through the stable projection failure code. */ }
        return coreErr("projection_write_failure");
      }
    };
  }

  private async createClosedExternalAppPilot(input: unknown): Promise<unknown> {
    if (!isRecord(input) || !hasExactKeys(input, ["confirmed"]) || input.confirmed !== true) throw new HttpProblem(400, "user_confirmation_required", "Starting a closed Codex Pilot requires an explicit user action.");
    const opened = this.requireOpened();
    const created = resultValue(opened.core.createClosedExternalAppPilot({ projectId: opened.project.id, evidenceClass: this.closedExternalAppHostRuntime.evidenceClass, actor: USER }));
    const inspection = await this.closedExternalAppHostRuntime.inspect();
    return resultValue(opened.core.recordClosedExternalAppPilotPreflight({
      projectId: opened.project.id,
      pilotId: created.id,
      expectedVersion: created.version,
      availability: inspection.availability,
      supportedVersion: inspection.supportedVersion,
      ...(inspection.verifiedAt === undefined ? {} : { verifiedAt: inspection.verifiedAt }),
      capabilities: inspection.capabilities,
    }));
  }

  private prepareClosedExternalAppPilotContext(pilotId: string, input: unknown): unknown {
    if (!isRecord(input) || !hasExactKeys(input, ["expectedVersion", "externalModelServiceMayBeCalled", "kind", "outputLimitBytes", "selectedMemoryItemIds", "timeoutMs"]) || !Number.isSafeInteger(input.expectedVersion) || !["candidate_generation", "continuity_check"].includes(String(input.kind)) || input.externalModelServiceMayBeCalled !== true || !Array.isArray(input.selectedMemoryItemIds) || input.selectedMemoryItemIds.length > 64 || input.selectedMemoryItemIds.some((item) => typeof item !== "string") || new Set(input.selectedMemoryItemIds).size !== input.selectedMemoryItemIds.length || !Number.isSafeInteger(input.timeoutMs) || !Number.isSafeInteger(input.outputLimitBytes)) throw new HttpProblem(400, "invalid_input", "The exact Pilot Context Manifest request is invalid.");
    const opened = this.requireOpened();
    return resultValue(opened.core.prepareClosedExternalAppPilotContext({
      projectId: opened.project.id,
      pilotId,
      expectedVersion: Number(input.expectedVersion),
      kind: input.kind as ClosedCodexPilotKind,
      selectedMemoryItemIds: input.selectedMemoryItemIds as string[],
      confirmationExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      externalModelServiceMayBeCalled: true,
      timeoutMs: Number(input.timeoutMs),
      outputLimitBytes: Number(input.outputLimitBytes),
      actor: USER,
    }));
  }

  private confirmClosedExternalAppPilotContext(pilotId: string, input: unknown): unknown {
    if (!isRecord(input) || !hasExactKeys(input, ["attemptId", "confirmationNonce", "confirmed", "expectedVersion", "manifestHash", "manifestId"]) || input.confirmed !== true || !Number.isSafeInteger(input.expectedVersion) || ![input.attemptId, input.confirmationNonce, input.manifestHash, input.manifestId].every((value) => typeof value === "string")) throw new HttpProblem(400, "user_confirmation_required", "Confirm this exact Host, Pilot attempt, nonce, and Manifest hash before dispatch.");
    const opened = this.requireOpened();
    return resultValue(opened.core.confirmClosedExternalAppPilotContext({ projectId: opened.project.id, pilotId, expectedVersion: Number(input.expectedVersion), attemptId: input.attemptId as string, manifestId: input.manifestId as string, manifestHash: input.manifestHash as string, confirmationNonce: input.confirmationNonce as string, actor: USER }));
  }

  private pilotRunBinding(pilot: ClosedExternalAppPilot, attemptId: string): { readonly manifest: ClosedExternalAppPilot["manifests"][number]; readonly binding: ClosedCodexPilotBinding } {
    const manifest = pilot.manifests.find((item) => item.attemptId === attemptId);
    if (manifest === undefined) throw new HttpProblem(404, "not_found", "The bound Pilot attempt was not found.");
    return {
      manifest,
      binding: {
        pilotId: pilot.id,
        attemptId,
        manifestId: manifest.id,
        manifestHash: manifest.payloadHash,
        projectId: pilot.projectId,
        briefId: manifest.payload.brief.id,
        briefVersion: manifest.payload.brief.version,
        episodeId: manifest.payload.episode.id,
        decisionIds: manifest.payload.decisions.map((item) => item.id),
        issueIds: manifest.payload.issues.map((item) => item.id),
        evidenceIds: manifest.payload.evidence.map((item) => item.id),
        canonicalStateHash: manifest.payload.projectStateHash,
        episodeStatus: manifest.payload.episode.status,
        decisionStates: manifest.payload.decisions.map((item) => ({ id: item.id, status: item.status })),
        issueStates: manifest.payload.issues.map((item) => ({ id: item.id, status: item.status })),
      },
    };
  }

  private async launchClosedExternalAppPilot(pilotId: string, input: unknown): Promise<unknown> {
    if (!isRecord(input) || !hasExactKeys(input, ["attemptId", "confirmed", "expectedVersion", "manifestHash"]) || input.confirmed !== true || !Number.isSafeInteger(input.expectedVersion) || typeof input.attemptId !== "string" || typeof input.manifestHash !== "string") throw new HttpProblem(400, "user_confirmation_required", "The exact confirmed Pilot attempt is required before launch.");
    const opened = this.requireOpened();
    const before = resultValue(opened.core.getClosedExternalAppPilot(opened.project.id, pilotId));
    if (before.status !== "context_confirmed") throw new HttpProblem(400, "user_confirmation_required", "Confirm the exact Context Manifest before launching Codex.");
    const run = this.pilotRunBinding(before, input.attemptId);
    if (run.manifest.payloadHash !== input.manifestHash) throw new HttpProblem(409, "context_binding_mismatch", "The confirmed Manifest hash no longer matches this attempt.");
    const pilot = resultValue(opened.core.startClosedExternalAppPilotAttempt({ projectId: opened.project.id, pilotId, expectedVersion: Number(input.expectedVersion), attemptId: input.attemptId, manifestHash: input.manifestHash }));
    const invocationId = pilot.attempts.find((item) => item.id === input.attemptId)?.invocationId;
    if (invocationId === undefined) throw new HttpProblem(500, "infrastructure_failure", "The bounded Codex invocation identity was not created.");
    resultValue(opened.core.markClosedExternalAppPilotAttemptRunning({ projectId: opened.project.id, pilotId, expectedVersion: pilot.version, attemptId: input.attemptId, invocationId }));
    const controller = new AbortController();
    if (this.#pilotAbort.has(pilotId)) throw new HttpProblem(409, "state_conflict", "This Pilot already has an active invocation.");
    this.#pilotAbort.set(pilotId, controller);
    try {
      const outcome = await this.closedExternalAppHostRuntime.run({ kind: run.manifest.purpose, projectRoot: opened.root, binding: run.binding, contextUtf8: run.manifest.payloadUtf8, signal: controller.signal, timeoutMs: run.manifest.disclosure.timeoutMs, outputLimitBytes: run.manifest.disclosure.outputLimitBytes });
      const current = resultValue(opened.core.getClosedExternalAppPilot(opened.project.id, pilotId));
      if (current.status === "cancelled") return current;
      if (!outcome.ok) {
        return resultValue(opened.core.failClosedExternalAppPilotAttempt({ projectId: opened.project.id, pilotId, expectedVersion: current.version, attemptId: input.attemptId, failureCode: outcome.error.code, publicReason: `The bounded Codex attempt stopped with ${outcome.error.code}; no candidate or continuity result was committed.` }));
      }
      if (run.manifest.purpose === "candidate_generation" && outcome.value.candidate !== undefined) {
        return resultValue(opened.core.receiveClosedExternalAppPilotCandidate({ projectId: opened.project.id, pilotId, expectedVersion: current.version, attemptId: input.attemptId, invocationId, manifestHash: input.manifestHash, mcpObservation: outcome.value.mcpObservation, candidate: outcome.value.candidate, stdoutBytes: outcome.value.stdoutBytes, stderrBytes: outcome.value.stderrBytes, usage: outcome.value.usage }));
      }
      if (run.manifest.purpose === "continuity_check" && outcome.value.continuity !== undefined) {
        return resultValue(opened.core.completeClosedExternalAppPilotContinuity({ projectId: opened.project.id, pilotId, expectedVersion: current.version, attemptId: input.attemptId, invocationId, manifestHash: input.manifestHash, observation: { ...outcome.value.continuity, mcpObservation: outcome.value.mcpObservation } }));
      }
      return resultValue(opened.core.failClosedExternalAppPilotAttempt({ projectId: opened.project.id, pilotId, expectedVersion: current.version, attemptId: input.attemptId, failureCode: "host_protocol_mismatch", publicReason: "The bounded Codex attempt returned no result matching its confirmed purpose." }));
    } finally {
      if (this.#pilotAbort.get(pilotId) === controller) this.#pilotAbort.delete(pilotId);
    }
  }

  private cancelClosedExternalAppPilot(pilotId: string, input: unknown): unknown {
    if (!isRecord(input) || !hasExactKeys(input, ["attemptId", "confirmed", "expectedVersion"]) || input.confirmed !== true || !Number.isSafeInteger(input.expectedVersion) || typeof input.attemptId !== "string") throw new HttpProblem(400, "user_confirmation_required", "Cancelling this exact Pilot attempt requires explicit confirmation.");
    const opened = this.requireOpened();
    this.#pilotAbort.get(pilotId)?.abort();
    return resultValue(opened.core.cancelClosedExternalAppPilotAttempt({ projectId: opened.project.id, pilotId, expectedVersion: Number(input.expectedVersion), attemptId: input.attemptId, actor: USER }));
  }

  private async serveClient(pathname: string, response: ServerResponse): Promise<void> {
    const decoded = decodeURIComponent(pathname);
    const isClientRoute = decoded === "/" || decoded === "/index.html" || (extname(decoded) === "" && !decoded.startsWith("/assets/"));
    const relative = isClientRoute ? "index.html" : decoded.slice(1);
    if (relative.includes("..") || relative.includes("\\") || (!isClientRoute && !relative.startsWith("assets/"))) {
      throw new HttpProblem(404, "client_asset_not_found", "The requested client asset was not found.");
    }
    const contentType = clientContentType(relative);
    if (contentType === undefined) throw new HttpProblem(404, "client_asset_not_found", "The requested client asset was not found.");
    try {
      const body = await readFile(join(this.clientAssetRoot, relative));
      asset(response, contentType, body, !isClientRoute && /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/u.test(relative));
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        if (isClientRoute) throw new HttpProblem(503, "client_assets_unavailable", "The production Research Room client is missing. Rebuild the local App.");
        throw new HttpProblem(404, "client_asset_not_found", "The requested client asset was not found.");
      }
      throw error;
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!hostAllowed(request.headers.host)) throw new HttpProblem(421, "loopback_host_required", "The Research Room accepts only loopback Host headers.");
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) { await this.serveClient(url.pathname, response); return; }
      if (request.method === "GET" && url.pathname === "/api/status") {
        const languagePreference = await this.readLanguagePreference();
        const brief = this.#opened === undefined ? undefined : resultValue(this.#opened.core.getBriefState(this.#opened.project.id));
        json(response, 200, { ok: true, value: { localOnly: true, telemetry: false, projectOpen: this.#opened !== undefined, recoveryRequired: this.#recoveryRoot !== undefined, projectSetupRequired: this.#opened !== undefined && brief === undefined, ...(this.#opened ? { project: this.#opened.project } : {}), directoryPickerAvailable: this.directoryPicker !== undefined, languagePreference: languagePreference ?? null, sessionToken: this.sessionToken } }); return;
      }

      if (request.method === "POST" || request.method === "DELETE") this.authorize(request);
      if (request.method === "POST" && url.pathname === "/api/preferences/language") { json(response, 200, { ok: true, value: await this.setLanguagePreference(await readBody(request)) }); return; }
      await this.requireLanguagePreference();
      if (request.method === "GET" && url.pathname === "/api/provider") { json(response, 200, { ok: true, value: await this.providerStatus() }); return; }
      if (request.method === "GET" && url.pathname === "/api/codex-host") { json(response, 200, { ok: true, value: await this.closedExternalAppHostRuntime.inspect() }); return; }
      if (request.method === "POST" && url.pathname === "/api/provider") { json(response, 200, { ok: true, value: await this.saveProvider(await readBody(request)) }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/provider/config") { json(response, 200, { ok: true, value: await this.deleteProviderConfig() }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/provider/secret") { json(response, 200, { ok: true, value: await this.deleteProviderSecret() }); return; }
      if (request.method === "GET" && url.pathname === "/api/second-opinion-provider") { json(response, 200, { ok: true, value: await this.secondOpinionProviderStatus() }); return; }
      if (request.method === "POST" && url.pathname === "/api/second-opinion-provider") { json(response, 200, { ok: true, value: await this.saveSecondOpinionProvider(await readBody(request)) }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/second-opinion-provider/config") { json(response, 200, { ok: true, value: await this.deleteSecondOpinionProviderConfig() }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/second-opinion-provider/secret") { json(response, 200, { ok: true, value: await this.deleteSecondOpinionProviderSecret() }); return; }
      if (request.method === "POST" && url.pathname === "/api/second-opinion-provider/test") { json(response, 200, { ok: true, value: await this.testSecondOpinionProvider() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/select-directory/preview") { json(response, 200, { ok: true, value: await this.previewSelectedDirectory() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/initialize-selected") { json(response, 200, { ok: true, value: await this.initializeSelectedDirectory(await readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/select-directory") { json(response, 200, { ok: true, value: await this.selectDirectory() }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/project/select-directory") { json(response, 200, { ok: true, value: this.cancelDirectoryPicker() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/open") { json(response, 200, { ok: true, value: await this.openProject(await readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/brief") { json(response, 200, { ok: true, value: await this.activateInitialBrief(await readBody(request)) }); return; }
      if (request.method === "GET" && url.pathname === "/api/project/recovery") { json(response, 200, { ok: true, value: await this.recoveryStatus() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/recovery/backup") { json(response, 201, { ok: true, value: await this.createRecoveryBackup() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/recovery/restore/preview") { json(response, 200, { ok: true, value: await this.prepareRecoveryRestore(await readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/recovery/restore") { json(response, 200, { ok: true, value: await this.executeRecoveryRestore(await readBody(request)) }); return; }
      const opened = this.requireOpened();
      if (request.method === "POST" && url.pathname === "/api/project/external-app-pilots") { json(response, 201, { ok: true, value: await this.createClosedExternalAppPilot(await readBody(request)) }); return; }
      if (request.method === "GET" && url.pathname === "/api/project/external-app-pilots") {
        if ([...url.searchParams.keys()].some((key) => key !== "limit" && key !== "cursor")) throw new HttpProblem(400, "invalid_input", "The Pilot list query is invalid.");
        const rawLimit = url.searchParams.get("limit") ?? "50"; const cursor = url.searchParams.get("cursor") ?? undefined;
        if (!/^\d{1,3}$/u.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200 || (cursor !== undefined && (cursor.length === 0 || cursor.length > 8192))) throw new HttpProblem(400, "invalid_input", "The Pilot list query is invalid.");
        json(response, 200, { ok: true, value: resultValue(opened.core.listClosedExternalAppPilots(opened.project.id, { limit: Number(rawLimit), ...(cursor ? { cursor } : {}) })) }); return;
      }
      const pilotDetail = /^\/api\/project\/external-app-pilots\/(rpil_[0-9A-HJKMNP-TV-Z]{26})$/u.exec(url.pathname);
      if (request.method === "GET" && pilotDetail?.[1]) { json(response, 200, { ok: true, value: resultValue(opened.core.getClosedExternalAppPilot(opened.project.id, pilotDetail[1])) }); return; }
      const pilotEvidence = /^\/api\/project\/external-app-pilots\/(rpil_[0-9A-HJKMNP-TV-Z]{26})\/evidence$/u.exec(url.pathname);
      if (request.method === "GET" && pilotEvidence?.[1]) { json(response, 200, { ok: true, value: resultValue(opened.core.exportClosedExternalAppPilotEvidence(opened.project.id, pilotEvidence[1])) }); return; }
      const pilotAction = /^\/api\/project\/external-app-pilots\/(rpil_[0-9A-HJKMNP-TV-Z]{26})\/(context|confirm|launch|cancel|feedback|close)$/u.exec(url.pathname);
      if (request.method === "POST" && pilotAction?.[1] && pilotAction[2]) {
        const body = await readBody(request);
        const value = pilotAction[2] === "context" ? this.prepareClosedExternalAppPilotContext(pilotAction[1], body)
          : pilotAction[2] === "confirm" ? this.confirmClosedExternalAppPilotContext(pilotAction[1], body)
            : pilotAction[2] === "launch" ? await this.launchClosedExternalAppPilot(pilotAction[1], body)
              : pilotAction[2] === "cancel" ? this.cancelClosedExternalAppPilot(pilotAction[1], body)
                : pilotAction[2] === "feedback" ? (() => {
                  if (!isRecord(body) || !hasExactKeys(body, ["codes", "confirmed", "expectedVersion", "note"]) || body.confirmed !== true || !Number.isSafeInteger(body.expectedVersion) || !Array.isArray(body.codes) || body.codes.some((item) => typeof item !== "string") || typeof body.note !== "string") throw new HttpProblem(400, "invalid_input", "The local Pilot feedback is invalid.");
                  return resultValue(opened.core.recordClosedExternalAppPilotFeedback({ projectId: opened.project.id, pilotId: pilotAction[1], expectedVersion: Number(body.expectedVersion), codes: body.codes as never, ...(body.note.trim().length === 0 ? {} : { note: body.note }), actor: USER }));
                })()
                  : (() => {
                    if (!isRecord(body) || !hasExactKeys(body, ["confirmed", "expectedVersion"]) || body.confirmed !== true || !Number.isSafeInteger(body.expectedVersion)) throw new HttpProblem(400, "user_confirmation_required", "Closing the local Pilot requires explicit confirmation.");
                    return resultValue(opened.core.closeClosedExternalAppPilot({ projectId: opened.project.id, pilotId: pilotAction[1], expectedVersion: Number(body.expectedVersion), actor: USER }));
                  })();
        json(response, 200, { ok: true, value }); return;
      }
      const candidateAction = /^\/api\/project\/external-app-pilots\/(rpil_[0-9A-HJKMNP-TV-Z]{26})\/candidate\/(import|reject)$/u.exec(url.pathname);
      if (request.method === "POST" && candidateAction?.[1] && candidateAction[2]) {
        const body = await readBody(request);
        if (!isRecord(body) || !hasExactKeys(body, ["confirmed", "expectedVersion"]) || body.confirmed !== true || !Number.isSafeInteger(body.expectedVersion)) throw new HttpProblem(400, "user_confirmation_required", "Choose whether to import or reject this exact model-proposed candidate.");
        const value = candidateAction[2] === "import"
          ? resultValue(opened.core.importClosedExternalAppPilotCandidate({ projectId: opened.project.id, pilotId: candidateAction[1], expectedVersion: Number(body.expectedVersion), actor: USER }))
          : resultValue(opened.core.rejectClosedExternalAppPilotCandidate({ projectId: opened.project.id, pilotId: candidateAction[1], expectedVersion: Number(body.expectedVersion), actor: USER }));
        json(response, 200, { ok: true, value }); return;
      }
      const pilotReviewRestore = /^\/api\/project\/external-app-pilots\/(rpil_[0-9A-HJKMNP-TV-Z]{26})\/review\/restore$/u.exec(url.pathname);
      if (request.method === "POST" && pilotReviewRestore?.[1]) {
        const body = await readBody(request);
        if (!isRecord(body) || !hasExactKeys(body, ["confirmed", "expectedVersion"]) || body.confirmed !== true || !Number.isSafeInteger(body.expectedVersion)) throw new HttpProblem(400, "user_confirmation_required", "Restoring the bound deterministic Review requires the user to confirm this Pilot version.");
        json(response, 200, { ok: true, value: resultValue(opened.core.restoreClosedExternalAppPilotReview({ projectId: opened.project.id, pilotId: pilotReviewRestore[1], expectedPilotVersion: Number(body.expectedVersion), actor: USER })) }); return;
      }
      const pilotReview = /^\/api\/project\/external-app-pilots\/(rpil_[0-9A-HJKMNP-TV-Z]{26})\/review\/analyze$/u.exec(url.pathname);
      if (request.method === "POST" && pilotReview?.[1]) {
        const body = await readBody(request);
        if (!isRecord(body) || !hasExactKeys(body, ["confirmationNonce", "confirmed", "manifestHash", "reviewId"]) || body.confirmed !== true || ![body.confirmationNonce, body.manifestHash, body.reviewId].every((item) => typeof item === "string")) throw new HttpProblem(400, "user_confirmation_required", "The bound Review analysis requires explicit confirmation.");
        const pilot = resultValue(opened.core.getClosedExternalAppPilot(opened.project.id, pilotReview[1]));
        if (pilot.review?.reviewId !== body.reviewId) throw new HttpProblem(409, "cross_project_reference", "The Review is not bound to this Pilot.");
        json(response, 200, { ok: true, value: resultValue(await opened.core.analyzeResearchRoomSuggestion({ reviewId: body.reviewId as string, confirmationNonce: body.confirmationNonce as string, manifestHash: body.manifestHash as string, memoryProvider: await this.projectMemoryProviderBinding() })) }); return;
      }
      const pilotDisposition = /^\/api\/project\/external-app-pilots\/(rpil_[0-9A-HJKMNP-TV-Z]{26})\/disposition$/u.exec(url.pathname);
      if (request.method === "POST" && pilotDisposition?.[1]) {
        const body = await readBody(request);
        const required = ["authorityNonce", "confirmed", "disposition", "expectedStateBinding", "expectedVersion", "reason", "reviewId"];
        const optional = body && typeof body === "object" && "disposition" in body && body.disposition === "modified_accepted" ? ["modifiedProposal"] : body && typeof body === "object" && "disposition" in body && body.disposition === "direction_changed" ? ["redirectQuestion"] : [];
        if (!isRecord(body) || !hasExactKeys(body, [...required, ...optional]) || body.confirmed !== true || !Number.isSafeInteger(body.expectedVersion) || ![body.authorityNonce, body.disposition, body.reason, body.reviewId, ...optional.map((key) => body[key])].every((item) => typeof item === "string") || !isRecord(body.expectedStateBinding)) throw new HttpProblem(400, "user_confirmation_required", "Only the user can commit the bound Review disposition.");
        json(response, 200, { ok: true, value: resultValue(opened.core.commitClosedExternalAppPilotDisposition({ projectId: opened.project.id, pilotId: pilotDisposition[1], expectedPilotVersion: Number(body.expectedVersion), reviewId: body.reviewId as string, authorityNonce: body.authorityNonce as string, expectedStateBinding: body.expectedStateBinding as never, disposition: body.disposition as never, reason: body.reason as string, ...(typeof body.modifiedProposal === "string" ? { modifiedProposal: body.modifiedProposal } : {}), ...(typeof body.redirectQuestion === "string" ? { redirectQuestion: body.redirectQuestion } : {}), actor: USER })) }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/project/memory") {
        if ([...url.searchParams.keys()].some((key) => key !== "limit" && key !== "cursor")) throw new HttpProblem(400, "invalid_input", "The project-memory query is invalid.");
        const rawLimit = url.searchParams.get("limit") ?? "50";
        const cursor = url.searchParams.get("cursor") ?? undefined;
        if (!/^\d{1,3}$/u.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200 || (cursor !== undefined && (cursor.length === 0 || cursor.length > 8192))) throw new HttpProblem(400, "invalid_input", "The project-memory query is invalid.");
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getProjectMemoryProjection(opened.project.id, { limit: Number(rawLimit), ...(cursor ? { cursor } : {}) })) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/project/memory/candidates") {
        const body = confirmedProjectCommand(await readBody(request), "create_project_memory_candidate", ["commandType", "confirmed", "content", "kind", "outboundPolicy", "projectId", "publicReason", "retention", "sensitivity"], opened.project.id);
        if (!isRecord(body.content) || !isRecord(body.retention) || text(body.publicReason, 4_096) === undefined) throw new HttpProblem(400, "invalid_input", "The project-memory candidate is invalid.");
        const value = resultValue(opened.core.createProjectMemoryCandidate({ projectId: opened.project.id, kind: body.kind as never, content: body.content as never, retention: body.retention as never, sensitivity: body.sensitivity as never, outboundPolicy: body.outboundPolicy as never, publicReason: body.publicReason as string, actor: USER }));
        json(response, 200, { ok: true, value }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/project/memory/pin") {
        const body = confirmedProjectCommand(await readBody(request), "pin_project_object_to_memory", ["commandType", "confirmed", "content", "kind", "objectId", "objectKind", "outboundPolicy", "projectId", "publicReason", "retention", "sensitivity"], opened.project.id);
        if (!isRecord(body.content) || !isRecord(body.retention) || text(body.objectId, 128) === undefined || text(body.publicReason, 4_096) === undefined) throw new HttpProblem(400, "invalid_input", "The project-object memory pin is invalid.");
        const value = resultValue(opened.core.createPinnedProjectMemoryCandidate({ projectId: opened.project.id, objectKind: body.objectKind as never, objectId: body.objectId as string, kind: body.kind as never, content: body.content as never, retention: body.retention as never, sensitivity: body.sensitivity as never, outboundPolicy: body.outboundPolicy as never, publicReason: body.publicReason as string, actor: USER }));
        json(response, 200, { ok: true, value }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/project/memory/checkpoint") {
        const body = confirmedProjectCommand(await readBody(request), "review_project_resume", ["commandType", "confirmed", "projectId", "publicReason"], opened.project.id);
        const publicReason = text(body.publicReason, 4_096); if (publicReason === undefined) throw new HttpProblem(400, "invalid_input", "The Resume Checkpoint reason is required.");
        json(response, 200, { ok: true, value: resultValue(opened.core.reviewProjectResume({ projectId: opened.project.id, publicReason, actor: USER })) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/project/memory/manifests/prepare") {
        const body = confirmedProjectCommand(await readBody(request), "prepare_project_memory_manifest", ["commandType", "confirmed", "projectId", "selectedItemIds"], opened.project.id);
        if (!Array.isArray(body.selectedItemIds) || body.selectedItemIds.some((item) => typeof item !== "string")) throw new HttpProblem(400, "invalid_input", "The Context Manifest selection is invalid.");
        const provider = await this.projectMemoryProviderBinding();
        json(response, 200, { ok: true, value: resultValue(opened.core.prepareProjectMemoryManifest({ projectId: opened.project.id, selectedItemIds: body.selectedItemIds as string[], provider, actor: USER })) }); return;
      }
      const memoryManifestAction = /^\/api\/project\/memory\/manifests\/(rman_[0-9A-HJKMNP-TV-Z]{26})\/(confirm|consume)$/u.exec(url.pathname);
      if (request.method === "POST" && memoryManifestAction?.[1] && memoryManifestAction[2]) {
        const manifestId = memoryManifestAction[1];
        const action = memoryManifestAction[2];
        const body = confirmedProjectCommand(await readBody(request), action === "confirm" ? "confirm_project_memory_manifest" : "consume_project_memory_manifest", action === "confirm" ? ["commandType", "confirmationNonce", "confirmed", "expectedVersion", "manifestHash", "projectId"] : ["commandType", "confirmed", "expectedVersion", "manifestHash", "projectId"], opened.project.id);
        if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || text(body.manifestHash, 64) === undefined) throw new HttpProblem(400, "invalid_input", "The Context Manifest confirmation is invalid.");
        const provider = await this.projectMemoryProviderBinding();
        const value = action === "confirm"
          ? resultValue(opened.core.confirmProjectMemoryManifest({ projectId: opened.project.id, manifestId, expectedVersion: Number(body.expectedVersion), confirmationNonce: String(body.confirmationNonce), manifestHash: String(body.manifestHash), provider, actor: USER }))
          : resultValue(opened.core.consumeProjectMemoryManifest({ projectId: opened.project.id, manifestId, expectedVersion: Number(body.expectedVersion), manifestHash: String(body.manifestHash), provider }));
        json(response, 200, { ok: true, value }); return;
      }
      const memoryAction = /^\/api\/project\/memory\/(rmem_[0-9A-HJKMNP-TV-Z]{26})\/(confirm|edit|renew|retire|forget)$/u.exec(url.pathname);
      if (request.method === "POST" && memoryAction?.[1] && memoryAction[2]) {
        const itemId = memoryAction[1]; const action = memoryAction[2]; const raw = await readBody(request);
        if (action === "confirm") {
          const body = confirmedProjectCommand(raw, "confirm_project_memory", ["commandType", "confirmed", "expectedVersion", "projectId", "publicReason"], opened.project.id);
          if (!Number.isSafeInteger(body.expectedVersion) || text(body.publicReason, 4_096) === undefined) throw new HttpProblem(400, "invalid_input", "The project-memory confirmation is invalid.");
          json(response, 200, { ok: true, value: resultValue(opened.core.confirmProjectMemory({ projectId: opened.project.id, itemId, expectedVersion: Number(body.expectedVersion), publicReason: body.publicReason as string, actor: USER })) }); return;
        }
        if (action === "edit") {
          const body = confirmedProjectCommand(raw, "edit_project_memory", ["commandType", "confirmed", "content", "expectedVersion", "outboundPolicy", "projectId", "publicReason", "retention", "sensitivity"], opened.project.id);
          if (!Number.isSafeInteger(body.expectedVersion) || !isRecord(body.content) || !isRecord(body.retention) || text(body.publicReason, 4_096) === undefined) throw new HttpProblem(400, "invalid_input", "The project-memory edit is invalid.");
          json(response, 200, { ok: true, value: resultValue(opened.core.editProjectMemory({ projectId: opened.project.id, itemId, expectedVersion: Number(body.expectedVersion), content: body.content as never, retention: body.retention as never, sensitivity: body.sensitivity as never, outboundPolicy: body.outboundPolicy as never, publicReason: body.publicReason as string, actor: USER })) }); return;
        }
        if (action === "renew") {
          const body = confirmedProjectCommand(raw, "renew_project_memory", ["commandType", "confirmed", "expectedVersion", "projectId", "publicReason", "retention"], opened.project.id);
          if (!Number.isSafeInteger(body.expectedVersion) || !isRecord(body.retention) || text(body.publicReason, 4_096) === undefined) throw new HttpProblem(400, "invalid_input", "The project-memory renewal is invalid.");
          json(response, 200, { ok: true, value: resultValue(opened.core.renewProjectMemory({ projectId: opened.project.id, itemId, expectedVersion: Number(body.expectedVersion), retention: body.retention as never, publicReason: body.publicReason as string, actor: USER })) }); return;
        }
        if (action === "retire") {
          const body = confirmedProjectCommand(raw, "retire_project_memory", ["commandType", "confirmed", "expectedVersion", "projectId", "publicReason"], opened.project.id);
          if (!Number.isSafeInteger(body.expectedVersion) || text(body.publicReason, 4_096) === undefined) throw new HttpProblem(400, "invalid_input", "The project-memory retire command is invalid.");
          json(response, 200, { ok: true, value: resultValue(opened.core.retireProjectMemory({ projectId: opened.project.id, itemId, expectedVersion: Number(body.expectedVersion), publicReason: body.publicReason as string, actor: USER })) }); return;
        }
        const body = confirmedProjectCommand(raw, "forget_project_memory", ["commandType", "confirmation", "confirmed", "expectedVersion", "projectId", "publicReason"], opened.project.id);
        if (!Number.isSafeInteger(body.expectedVersion) || body.confirmation !== "FORGET" || body.publicReason !== "user_requested_irreversible_forget") throw new HttpProblem(400, "invalid_input", "The irreversible forget confirmation is invalid.");
        json(response, 200, { ok: true, value: resultValue(opened.core.forgetProjectMemory({ projectId: opened.project.id, itemId, expectedVersion: Number(body.expectedVersion), confirmation: "FORGET", publicReason: "user_requested_irreversible_forget", actor: USER })) }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/project/overview") {
        const provider = await this.providerStatus();
        const providerStatus = isRecord(provider) && provider.mode === "configured" ? "configured" as const : "ledger_only" as const;
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getProjectOverviewProjection(opened.project.id, { providerStatus })) }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/project/brief") {
        if ([...url.searchParams.keys()].some((key) => key !== "historyLimit")) throw new HttpProblem(400, "invalid_input", "The Brief query is invalid.");
        const raw = url.searchParams.get("historyLimit") ?? "50";
        if (!/^\d{1,3}$/u.test(raw) || Number(raw) < 1 || Number(raw) > 200) throw new HttpProblem(400, "invalid_input", "The Brief history limit is invalid.");
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getBriefWorkspaceProjection(opened.project.id, Number(raw))) }); return;
      }
      const workspaceLists = Object.freeze({
        "/api/project/decisions": (query: ReturnType<typeof workspaceListRequest>) => opened.core.listDecisionProjections(opened.project.id, query),
        "/api/project/issues": (query: ReturnType<typeof workspaceListRequest>) => opened.core.listIssueProjections(opened.project.id, query),
        "/api/project/evidence": (query: ReturnType<typeof workspaceListRequest>) => opened.core.listEvidenceProjections(opened.project.id, query),
        "/api/project/episodes": (query: ReturnType<typeof workspaceListRequest>) => opened.core.listEpisodeProjections(opened.project.id, query),
        "/api/project/receipts": (query: ReturnType<typeof workspaceListRequest>) => opened.core.listReceiptProjections(opened.project.id, query),
        "/api/project/appeals": (query: ReturnType<typeof workspaceListRequest>) => opened.core.listAppealProjections(opened.project.id, query),
        "/api/project/deliberation-rooms": (query: ReturnType<typeof workspaceListRequest>) => opened.core.listDeliberationRoomProjections(opened.project.id, query),
      });
      if (request.method === "GET" && url.pathname in workspaceLists) {
        const read = workspaceLists[url.pathname as keyof typeof workspaceLists];
        const projection = read(workspaceListRequest(url)) as CoreResult<unknown>;
        json(response, 200, { ok: true, value: workspaceResultValue(projection) }); return;
      }
      const workspaceDetail = /^\/api\/project\/(decisions|issues|evidence|episodes|receipts|appeals|deliberation-rooms)\/([a-z]+_[0-9A-HJKMNP-TV-Z]{26})$/u.exec(url.pathname);
      if (request.method === "GET" && workspaceDetail?.[1] && workspaceDetail[2]) {
        const id = workspaceDetail[2];
        const value = workspaceDetail[1] === "decisions" ? workspaceResultValue(opened.core.getDecisionProjection(opened.project.id, id))
          : workspaceDetail[1] === "issues" ? workspaceResultValue(opened.core.getIssueProjection(opened.project.id, id))
            : workspaceDetail[1] === "evidence" ? workspaceResultValue(opened.core.getEvidenceProjection(opened.project.id, id))
              : workspaceDetail[1] === "episodes" ? workspaceResultValue(opened.core.getEpisodeProjection(opened.project.id, id))
                : workspaceDetail[1] === "receipts" ? workspaceResultValue(opened.core.getReceiptProjection(opened.project.id, id))
                  : workspaceDetail[1] === "appeals" ? workspaceResultValue(opened.core.getAppealProjection(opened.project.id, id))
                    : workspaceResultValue(opened.core.getDeliberationRoomProjection(opened.project.id, id));
        if (value === undefined) throw new HttpProblem(404, "not_found", "The requested research record was not found.");
        json(response, 200, { ok: true, value }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/project/attention") {
        if ([...url.searchParams.keys()].length > 0) throw new HttpProblem(400, "invalid_input", "The Attention query is invalid.");
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getAttentionProjection(opened.project.id)) }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/project/search") {
        if ([...url.searchParams.keys()].some((key) => key !== "q" && key !== "limit" && key !== "cursor")) throw new HttpProblem(400, "invalid_input", "The project search is invalid.");
        const query = url.searchParams.get("q") ?? ""; const rawLimit = url.searchParams.get("limit") ?? "50";
        const cursor = url.searchParams.get("cursor") ?? undefined;
        if (!/^\d{1,3}$/u.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200 || Buffer.byteLength(query, "utf8") > 512 || (cursor !== undefined && (cursor.length === 0 || cursor.length > 8192))) throw new HttpProblem(400, "invalid_input", "The project search is invalid.");
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.searchResearchObjects(opened.project.id, { query, limit: Number(rawLimit), ...(cursor ? { cursor } : {}) })) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/project/deliberation-rooms") {
        const body = await readBody(request);
        if (!isRecord(body) || !hasExactKeys(body, ["commandId", "commandType", "confirmed", "projectId", "question", "sourceKind", "sourceObjectId", "title"]) || body.commandType !== "create_deliberation_room") throw new HttpProblem(400, "invalid_input", "The Deliberation Room draft is invalid.");
        if (body.projectId !== opened.project.id) throw new HttpProblem(409, "cross_project_reference", "The Deliberation Room is bound to another project.");
        if (body.confirmed !== true || text(body.commandId, 128) === undefined) throw new HttpProblem(400, "user_confirmation_required", "Creating a Deliberation Room requires an explicit user action.");
        const created = resultValue(opened.core.createDeliberationRoom({ commandId: body.commandId as string, projectId: opened.project.id, sourceKind: body.sourceKind as never, sourceObjectId: body.sourceObjectId as string, question: body.question as string, title: body.title as string, actor: USER }));
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getDeliberationRoomProjection(opened.project.id, created.id)) }); return;
      }
      const deliberationQuery = /^\/api\/project\/deliberation-rooms\/(rdlr_[0-9A-HJKMNP-TV-Z]{26})\/(assessments|difference)$/u.exec(url.pathname);
      if (request.method === "GET" && deliberationQuery?.[1] && deliberationQuery[2]) {
        if ([...url.searchParams.keys()].length > 0) throw new HttpProblem(400, "invalid_input", "The Deliberation Room query is invalid.");
        const detail = workspaceResultValue(opened.core.getDeliberationRoomProjection(opened.project.id, deliberationQuery[1]));
        if (detail === undefined) throw new HttpProblem(404, "not_found", "The Deliberation Room was not found.");
        json(response, 200, { ok: true, value: deliberationQuery[2] === "assessments" ? { schemaVersion: "1.0.0", items: detail.assessments } : { schemaVersion: "1.0.0", differenceSummary: detail.differenceSummary ?? null } }); return;
      }
      const deliberationAction = /^\/api\/project\/deliberation-rooms\/(rdlr_[0-9A-HJKMNP-TV-Z]{26})\/(refresh-source|prepare|run|cancel|reveal|prepare-retry|run-retry|prepare-challenge|run-challenge|finish-review|manual-opinion|resolve)$/u.exec(url.pathname);
      if (request.method === "POST" && deliberationAction?.[1] && deliberationAction[2]) {
        const roomId = deliberationAction[1]; const action = deliberationAction[2];
        const body = await readBody(request);
        if (!isRecord(body) || body.projectId !== opened.project.id) {
          if (isRecord(body) && typeof body.projectId === "string") throw new HttpProblem(409, "cross_project_reference", "The Deliberation Room command is bound to another project.");
          throw new HttpProblem(400, "invalid_input", "The Deliberation Room command is invalid.");
        }
        if (body.confirmed !== true) throw new HttpProblem(400, "user_confirmation_required", "The Deliberation Room command requires explicit user confirmation.");
        if (action === "refresh-source") {
          if (!hasExactKeys(body, ["commandType", "confirmed", "projectId"]) || body.commandType !== "refresh_deliberation_source") throw new HttpProblem(400, "invalid_input", "The source refresh is invalid.");
          resultValue(opened.core.refreshDeliberationRoomSource(opened.project.id, roomId));
        } else {
          if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1 || text(body.commandId, 128) === undefined) throw new HttpProblem(400, "invalid_input", "The Deliberation Room version or command identifier is invalid.");
          const common = { commandId: body.commandId as string, projectId: opened.project.id, roomId, expectedVersion: Number(body.expectedVersion) as never, actor: USER };
          if (action === "prepare") {
            if (!hasExactKeys(body, ["allowedContext", "commandId", "commandType", "confirmed", "expectedVersion", "projectId", "revisionId"]) || body.commandType !== "prepare_deliberation_manifests" || !isRecord(body.allowedContext) || !hasExactKeys(body.allowedContext, ["decisionIds", "evidenceIds", "includeBrief", "issueIds"]) || body.allowedContext.includeBrief !== true || ![body.allowedContext.decisionIds, body.allowedContext.issueIds, body.allowedContext.evidenceIds].every((value) => Array.isArray(value) && value.every((item) => typeof item === "string"))) throw new HttpProblem(400, "invalid_input", "The Deliberation Room Context is invalid.");
            const prepared = resultValue(opened.core.prepareDeliberationRoom({ ...common, revisionId: body.revisionId as string, includeBrief: true, decisionIds: body.allowedContext.decisionIds as string[], issueIds: body.allowedContext.issueIds as string[], evidenceIds: body.allowedContext.evidenceIds as string[] }));
            json(response, 200, { ok: true, value: { schemaVersion: "1.0.0", contextManifestsVisible: true, room: workspaceResultValue(opened.core.getDeliberationRoomProjection(opened.project.id, roomId)), manifests: prepared.manifests, providerPreviews: prepared.providerPreviews } }); return;
          }
          if (action === "run") {
            if (!hasExactKeys(body, ["commandId", "commandType", "confirmed", "expectedVersion", "manifestHashes", "projectId"]) || body.commandType !== "run_deliberation_blind_round" || !Array.isArray(body.manifestHashes) || body.manifestHashes.length !== 2 || !body.manifestHashes.every((item) => typeof item === "string")) throw new HttpProblem(400, "invalid_input", "The blind-round confirmation is invalid.");
            resultValue(await opened.core.runDeliberationRoomBlindRound({ ...common, confirmedManifestHashes: body.manifestHashes as unknown as readonly [string, string] }));
          } else if (action === "cancel") {
            if (!hasExactKeys(body, ["commandId", "commandType", "confirmed", "expectedVersion", "projectId"]) || body.commandType !== "cancel_deliberation_run") throw new HttpProblem(400, "invalid_input", "The cancellation is invalid.");
            const current = resultValue(opened.core.getDeliberationRoom(opened.project.id, roomId));
            if (current === undefined) throw new HttpProblem(404, "not_found", "The Deliberation Room was not found.");
            if (current.version !== Number(body.expectedVersion)) throw new HttpProblem(409, "stale_state", "The Deliberation Room changed before cancellation.");
            resultValue(opened.core.cancelActiveDeliberationRoom(opened.project.id, roomId));
          } else if (action === "reveal") {
            if (!hasExactKeys(body, ["commandId", "commandType", "confirmed", "expectedVersion", "mode", "projectId"]) || body.commandType !== "reveal_deliberation_round" || !["complete", "partial", "cancelled"].includes(String(body.mode))) throw new HttpProblem(400, "invalid_input", "The reveal confirmation is invalid.");
            resultValue(opened.core.revealDeliberationRoom({ ...common, mode: body.mode as never }));
          } else if (action === "prepare-retry") {
            if (!hasExactKeys(body, ["commandId", "commandType", "confirmed", "expectedVersion", "projectId"]) || body.commandType !== "prepare_deliberation_participant_retry") throw new HttpProblem(400, "invalid_input", "The failed-participant retry is invalid.");
            const prepared = resultValue(opened.core.prepareDeliberationParticipantRetry(common));
            json(response, 200, { ok: true, value: { schemaVersion: "1.0.0", contextManifestVisible: true, room: workspaceResultValue(opened.core.getDeliberationRoomProjection(opened.project.id, roomId)), manifest: prepared.manifest, providerPreview: prepared.providerPreview } }); return;
          } else if (action === "run-retry") {
            if (!hasExactKeys(body, ["commandId", "commandType", "confirmed", "expectedVersion", "manifestHash", "projectId", "retryId"]) || body.commandType !== "run_deliberation_participant_retry") throw new HttpProblem(400, "invalid_input", "The failed-participant retry confirmation is invalid.");
            resultValue(await opened.core.runDeliberationParticipantRetry({ ...common, retryId: body.retryId as string, confirmedManifestHash: body.manifestHash as string }));
          } else if (action === "prepare-challenge") {
            if (!hasExactKeys(body, ["commandId", "commandType", "confirmed", "expectedVersion", "projectId", "question"]) || body.commandType !== "prepare_deliberation_challenge") throw new HttpProblem(400, "invalid_input", "The directed challenge is invalid.");
            const prepared = resultValue(opened.core.prepareDeliberationChallenge({ ...common, question: body.question as string }));
            json(response, 200, { ok: true, value: { schemaVersion: "1.0.0", contextManifestsVisible: true, sharedContextOnly: true, room: workspaceResultValue(opened.core.getDeliberationRoomProjection(opened.project.id, roomId)), manifests: prepared.manifests, providerPreviews: prepared.providerPreviews } }); return;
          } else if (action === "run-challenge") {
            if (!hasExactKeys(body, ["challengeId", "commandId", "commandType", "confirmed", "expectedVersion", "manifestHashes", "projectId"]) || body.commandType !== "run_deliberation_challenge" || !Array.isArray(body.manifestHashes) || body.manifestHashes.length !== 2 || !body.manifestHashes.every((item) => typeof item === "string")) throw new HttpProblem(400, "invalid_input", "The directed challenge confirmation is invalid.");
            resultValue(await opened.core.runDeliberationChallenge({ ...common, challengeId: body.challengeId as string, confirmedManifestHashes: body.manifestHashes as unknown as readonly [string, string] }));
          } else if (action === "finish-review") {
            if (!hasExactKeys(body, ["commandId", "commandType", "confirmed", "expectedVersion", "projectId"]) || body.commandType !== "finish_deliberation_difference_review") throw new HttpProblem(400, "invalid_input", "The review completion is invalid.");
            resultValue(opened.core.waitForDeliberationRoomResolution(common));
          } else if (action === "manual-opinion") {
            if (!hasExactKeys(body, ["capturedAt", "commandId", "commandType", "confirmed", "contextDisclosure", "expectedVersion", "modelClaim", "projectId", "providerClaim", "publicContent", "sawParticipantAOutput", "sawParticipantBOutput", "sourceLabel"]) || body.commandType !== "import_manual_external_opinion") throw new HttpProblem(400, "invalid_input", "The manual external opinion is invalid.");
            resultValue(opened.core.importManualExternalOpinion({ ...common, sourceLabel: body.sourceLabel as string, providerClaim: body.providerClaim as string, modelClaim: body.modelClaim as string, capturedAt: body.capturedAt as string, contextDisclosure: body.contextDisclosure as string, sawParticipantAOutput: body.sawParticipantAOutput as boolean, sawParticipantBOutput: body.sawParticipantBOutput as boolean, publicContent: body.publicContent as string }));
          } else {
            if (!hasExactKeys(body, ["commandId", "commandType", "combinedText", "confirmed", "expectedVersion", "kind", "projectId", "publicReason"]) || body.commandType !== "resolve_deliberation_room") throw new HttpProblem(400, "invalid_input", "The user Resolution is invalid.");
            resultValue(opened.core.resolveDeliberationRoom({ ...common, kind: body.kind as never, publicReason: body.publicReason as string, ...(typeof body.combinedText === "string" && body.combinedText.trim().length > 0 ? { combinedText: body.combinedText } : {}) }));
          }
        }
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getDeliberationRoomProjection(opened.project.id, roomId)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/project/appeals") {
        const body = await readBody(request);
        if (!isRecord(body) || !hasExactKeys(body, ["commandType", "confirmed", "findingId", "projectId", "receiptId", "statement"]) || body.commandType !== "create_correction_appeal") throw new HttpProblem(400, "invalid_input", "The correction appeal request is invalid.");
        if (body.projectId !== opened.project.id) throw new HttpProblem(409, "cross_project_reference", "The appeal is bound to another project.");
        if (body.confirmed !== true) throw new HttpProblem(400, "user_confirmation_required", "Creating an appeal requires an explicit user action.");
        const created = resultValue(opened.core.createCorrectionAppeal({ projectId: opened.project.id, receiptId: body.receiptId as string, findingId: body.findingId as string, statement: body.statement as never, actor: USER }));
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getAppealProjection(opened.project.id, created.id)) }); return;
      }
      const appealAction = /^\/api\/project\/appeals\/(rapl_[0-9A-HJKMNP-TV-Z]{26})\/(update|record|record-only|prepare-second-opinion|run-second-opinion|cancel-second-opinion|resolve)$/u.exec(url.pathname);
      if (request.method === "POST" && appealAction?.[1] && appealAction[2]) {
        const appealId = appealAction[1];
        const action = appealAction[2];
        const body = await readBody(request);
        if (!isRecord(body) || body.projectId !== opened.project.id) {
          if (isRecord(body) && typeof body.projectId === "string") throw new HttpProblem(409, "cross_project_reference", "The appeal command is bound to another project.");
          throw new HttpProblem(400, "invalid_input", "The correction appeal command is invalid.");
        }
        if (body.confirmed !== true) throw new HttpProblem(400, "user_confirmation_required", "The appeal command requires explicit user confirmation.");
        if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new HttpProblem(400, "invalid_input", "The expected appeal version is invalid.");
        const common = { projectId: opened.project.id, appealId, expectedVersion: Number(body.expectedVersion) as never, actor: USER };
        if (action === "update") {
          if (!hasExactKeys(body, ["commandType", "confirmed", "expectedVersion", "projectId", "statement"]) || body.commandType !== "update_correction_appeal") throw new HttpProblem(400, "invalid_input", "The appeal update is invalid.");
          resultValue(opened.core.updateCorrectionAppeal({ ...common, statement: body.statement as never }));
        } else if (action === "record") {
          if (!hasExactKeys(body, ["commandType", "confirmed", "expectedVersion", "projectId"]) || body.commandType !== "record_correction_appeal") throw new HttpProblem(400, "invalid_input", "The appeal record command is invalid.");
          resultValue(opened.core.recordCorrectionAppeal(common));
        } else if (action === "record-only") {
          if (!hasExactKeys(body, ["commandType", "confirmed", "expectedVersion", "projectId"]) || body.commandType !== "mark_correction_appeal_record_only") throw new HttpProblem(400, "invalid_input", "The record-only command is invalid.");
          resultValue(opened.core.markCorrectionAppealRecordOnly(common));
        } else if (action === "prepare-second-opinion") {
          if (!hasExactKeys(body, ["allowedContext", "commandType", "confirmed", "expectedVersion", "projectId"]) || body.commandType !== "prepare_correction_appeal_second_opinion" || !isRecord(body.allowedContext) || !hasExactKeys(body.allowedContext, ["decisionIds", "evidenceIds", "includeBrief", "issueIds"]) || typeof body.allowedContext.includeBrief !== "boolean" || ![body.allowedContext.decisionIds, body.allowedContext.issueIds, body.allowedContext.evidenceIds].every((value) => Array.isArray(value) && value.every((item) => typeof item === "string"))) throw new HttpProblem(400, "invalid_input", "The second-opinion preparation is invalid.");
          const prepared = resultValue(opened.core.prepareCorrectionAppealSecondOpinion({ ...common, allowedContext: body.allowedContext as never }));
          json(response, 200, { ok: true, value: { schemaVersion: "1.0.0", contextManifestVisible: prepared.contextManifestVisible, appeal: workspaceResultValue(opened.core.getAppealProjection(opened.project.id, appealId)), attemptId: prepared.attemptId, confirmationNonce: prepared.confirmationNonce, manifest: prepared.manifest, providerPreview: prepared.providerPreview } }); return;
        } else if (action === "run-second-opinion") {
          if (!hasExactKeys(body, ["attemptId", "commandType", "confirmationNonce", "confirmed", "expectedVersion", "manifestHash", "projectId"]) || body.commandType !== "run_correction_appeal_second_opinion") throw new HttpProblem(400, "invalid_input", "The second-opinion send confirmation is invalid.");
          resultValue(await opened.core.runCorrectionAppealSecondOpinion({ ...common, attemptId: body.attemptId as string, confirmationNonce: body.confirmationNonce as string, manifestHash: body.manifestHash as string }));
        } else if (action === "cancel-second-opinion") {
          if (!hasExactKeys(body, ["attemptId", "commandType", "confirmed", "expectedVersion", "projectId"]) || body.commandType !== "cancel_correction_appeal_second_opinion") throw new HttpProblem(400, "invalid_input", "The second-opinion cancellation is invalid.");
          resultValue(opened.core.cancelCorrectionAppealSecondOpinion({ ...common, attemptId: body.attemptId as string }));
        } else {
          if (!hasExactKeys(body, ["commandType", "confirmed", "expectedVersion", "kind", "projectId", "publicReason"]) || body.commandType !== "resolve_correction_appeal") throw new HttpProblem(400, "invalid_input", "The appeal resolution is invalid.");
          resultValue(opened.core.resolveCorrectionAppeal({ ...common, kind: body.kind as never, publicReason: body.publicReason as string }));
        }
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getAppealProjection(opened.project.id, appealId)) }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        if (resultValue(opened.core.getBriefState(opened.project.id)) === undefined) throw new HttpProblem(409, "brief_setup_required", "Complete the initial Research Brief in this browser.");
        json(response, 200, { ok: true, value: resultValue(opened.core.getResearchRoomState(opened.project.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/brief/candidate") {
        const body = confirmedCommand(await readBody(request), "propose_brief_change", ["changes", "commandType", "confirmed", "expectedVersion", "projectId", "reason"], opened.project.id);
        resultValue(opened.core.proposeBriefChange({ projectId: opened.project.id, actor: USER, changes: body.changes as never, reason: String(body.reason), expectedVersion: Number(body.expectedVersion) }));
        json(response, 200, { ok: true, value: resultValue(opened.core.getBriefWorkspaceProjection(opened.project.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/brief/activate") {
        const body = confirmedCommand(await readBody(request), "activate_brief_candidate", ["commandType", "confirmed", "expectedVersion", "projectId", "proposalId", "reason"], opened.project.id);
        const proposalId = text(body.proposalId, 128); if (proposalId === undefined) throw new HttpProblem(400, "invalid_input", "The Brief candidate is invalid.");
        const mutation = resultValue(opened.core.acceptBriefChangeWithProjection({ projectId: opened.project.id, proposalId, actor: USER, reason: String(body.reason), expectedVersion: Number(body.expectedVersion) }, this.briefProjectionPublisher(opened)));
        json(response, 200, { ok: true, value: { schemaVersion: "1.0.0", workspace: resultValue(opened.core.getBriefWorkspaceProjection(opened.project.id)), changedFields: mutation.changedFields } }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/decisions/record") {
        const body = confirmedCommand(await readBody(request), "record_decision", ["commandType", "confirmed", "effectiveBriefVersionId", "expectedVersion", "projectId", "rationale", "reason", "reopenConditions", "scope", "statement"], opened.project.id);
        const brief = resultValue(opened.core.getBriefWorkspaceProjection(opened.project.id, 1));
        if (brief.entityVersion !== Number(body.expectedVersion) || brief.active.id !== body.effectiveBriefVersionId) throw new HttpProblem(409, "stale_state", "The active Research Brief changed before the command.");
        const statement = text(body.statement, 4_096); const rationale = text(body.rationale, 4_096); const reason = text(body.reason, 4_096);
        if (statement === undefined || rationale === undefined || reason === undefined || !Array.isArray(body.reopenConditions)) throw new HttpProblem(400, "invalid_input", "The Decision proposal is invalid.");
        const created = resultValue(opened.core.recordDecision({ projectId: opened.project.id, actor: USER, statement, scope: body.scope as never, rationale: `${rationale}\n\nCommand reason: ${reason}`, effectiveBriefVersionId: brief.active.id, reopenConditions: body.reopenConditions as string[], status: "proposed" }));
        json(response, 200, { ok: true, value: resultValue(opened.core.getDecisionProjection(opened.project.id, created.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/decisions/transition") {
        const body = confirmedCommand(await readBody(request), "transition_decision", ["commandType", "confirmed", "decisionId", "expectedVersion", "projectId", "reason", "target"], opened.project.id);
        if (!["accepted", "rejected", "frozen"].includes(String(body.target))) throw new HttpProblem(400, "invalid_input", "The Decision transition is invalid.");
        const changed = authorityResultValue(opened.core.transitionDecision({ projectId: opened.project.id, decisionId: body.decisionId as string, actor: USER, target: body.target as never, reason: body.reason as string, expectedVersion: Number(body.expectedVersion) }));
        json(response, 200, { ok: true, value: resultValue(opened.core.getDecisionProjection(opened.project.id, changed.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/decisions/supersede") {
        const body = confirmedCommand(await readBody(request), "supersede_decision", ["commandType", "confirmed", "decisionId", "effectiveBriefVersionId", "expectedVersion", "projectId", "rationale", "reason", "reopenConditions", "scope", "statement"], opened.project.id);
        if (!Array.isArray(body.reopenConditions)) throw new HttpProblem(400, "invalid_input", "The replacement Decision is invalid.");
        const changed = authorityResultValue(opened.core.supersedeDecision({ projectId: opened.project.id, decisionId: body.decisionId as string, actor: USER, statement: body.statement as string, scope: body.scope as never, rationale: body.rationale as string, effectiveBriefVersionId: body.effectiveBriefVersionId as string, reopenConditions: body.reopenConditions as string[], reason: body.reason as string, expectedVersion: Number(body.expectedVersion) }));
        json(response, 200, { ok: true, value: { schemaVersion: "1.0.0", superseded: resultValue(opened.core.getDecisionProjection(opened.project.id, changed.superseded.id)), replacement: resultValue(opened.core.getDecisionProjection(opened.project.id, changed.replacement.id)) } }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/issues/resolve") {
        const body = confirmedCommand(await readBody(request), "resolve_issue", ["commandType", "confirmed", "expectedVersion", "issueId", "projectId", "reason", "resolutionEvidenceId"], opened.project.id);
        const evidenceId = text(body.resolutionEvidenceId, 128); if (evidenceId === undefined) throw new HttpProblem(400, "evidence_required", "Current canonical Evidence is required.");
        const evidence = workspaceResultValue(opened.core.getEvidenceProjection(opened.project.id, evidenceId));
        if (evidence?.state !== "current") throw new HttpProblem(400, "evidence_required", "Current canonical Evidence is required.");
        const changed = authorityResultValue(opened.core.resolveIssueWithCanonicalEvidence({ projectId: opened.project.id, issueId: body.issueId as string, actor: USER, reason: body.reason as string, resolutionEvidenceId: evidenceId, expectedVersion: Number(body.expectedVersion) }));
        json(response, 200, { ok: true, value: resultValue(opened.core.getIssueProjection(opened.project.id, changed.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/issues/waive") {
        const body = confirmedCommand(await readBody(request), "waive_issue", ["commandType", "confirmed", "expectedVersion", "invalidationCondition", "issueId", "projectId", "reason", "scope"], opened.project.id);
        const invalidationCondition = text(body.invalidationCondition, 4_096); if (invalidationCondition === undefined) throw new HttpProblem(400, "invalid_input", "The waiver invalidation condition is required.");
        const changed = authorityResultValue(opened.core.waiveIssue({ projectId: opened.project.id, issueId: body.issueId as string, actor: USER, scope: body.scope as never, reason: body.reason as string, invalidationCondition, expectedVersion: Number(body.expectedVersion) }));
        json(response, 200, { ok: true, value: resultValue(opened.core.getIssueProjection(opened.project.id, changed.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/issues/dispute") {
        const body = confirmedCommand(await readBody(request), "dispute_issue", ["commandType", "confirmed", "expectedVersion", "issueId", "projectId", "reason"], opened.project.id);
        const changed = authorityResultValue(opened.core.disputeIssue({ projectId: opened.project.id, issueId: body.issueId as string, actor: USER, reason: body.reason as string, expectedVersion: Number(body.expectedVersion) }));
        json(response, 200, { ok: true, value: resultValue(opened.core.getIssueProjection(opened.project.id, changed.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/issues/reopen") {
        const body = confirmedCommand(await readBody(request), "reopen_issue", ["commandType", "confirmed", "context", "expectedVersion", "issueId", "projectId", "reason"], opened.project.id);
        const changed = authorityResultValue(opened.core.reopenIssue({ projectId: opened.project.id, issueId: body.issueId as string, actor: USER, reason: body.reason as string, context: body.context as never, expectedVersion: Number(body.expectedVersion) }));
        json(response, 200, { ok: true, value: resultValue(opened.core.getIssueProjection(opened.project.id, changed.id)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/receipts/rollback") {
        const body = confirmedCommand(await readBody(request), "rollback_receipt", ["commandType", "confirmed", "expectedVersion", "projectId", "reason", "receiptId"], opened.project.id);
        const receiptId = text(body.receiptId, 128); if (receiptId === undefined) throw new HttpProblem(400, "invalid_input", "The Receipt identifier is invalid.");
        const before = workspaceResultValue(opened.core.getReceiptProjection(opened.project.id, receiptId));
        if (before === undefined) throw new HttpProblem(404, "not_found", "The Receipt was not found.");
        if (before.version !== Number(body.expectedVersion)) throw new HttpProblem(409, "stale_state", "The Receipt version changed before rollback.");
        const rolled = opened.core.rollbackResearchRoomReceipt({ projectId: opened.project.id, receiptId, expectedVersion: Number(body.expectedVersion), reason: String(body.reason), actor: USER });
        if (!rolled.ok && rolled.error.code === "stale_state") throw new HttpProblem(409, "rollback_conflict", "Newer project state prevents this rollback; no partial write was made.");
        resultValue(rolled);
        json(response, 200, { ok: true, value: workspaceResultValue(opened.core.getReceiptProjection(opened.project.id, receiptId)) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/reviews/prepare") {
        const body = await readBody(request); if (!isRecord(body) || !hasExactKeys(body, ["evidenceClass", "selectedMemoryItemIds", "suggestion"]) || !Array.isArray(body.selectedMemoryItemIds) || body.selectedMemoryItemIds.length > 64 || body.selectedMemoryItemIds.some((item) => typeof item !== "string") || new Set(body.selectedMemoryItemIds).size !== body.selectedMemoryItemIds.length) throw new HttpProblem(400, "invalid_input", "The review request is invalid.");
        const memoryProvider = await this.projectMemoryProviderBinding();
        json(response, 200, { ok: true, value: resultValue(opened.core.prepareResearchRoomReview({ projectId: opened.project.id, suggestion: body.suggestion as string, evidenceClass: body.evidenceClass as never, countsAsExternalEvidence: false, selectedMemoryItemIds: body.selectedMemoryItemIds as string[], memoryProvider, actor: USER })) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/reviews/analyze") {
        const body = await readBody(request); if (!isRecord(body)) throw new HttpProblem(400, "invalid_input", "The analysis confirmation is invalid.");
        const value = await opened.core.analyzeResearchRoomSuggestion({ reviewId: body.reviewId as string, confirmationNonce: body.confirmationNonce as string, manifestHash: body.manifestHash as string, memoryProvider: await this.projectMemoryProviderBinding() });
        json(response, 200, { ok: true, value: resultValue(value) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/reviews/cancel") {
        const body = await readBody(request); if (!isRecord(body)) throw new HttpProblem(400, "invalid_input", "The cancellation confirmation is invalid.");
        json(response, 200, { ok: true, value: resultValue(opened.core.cancelResearchRoomReview({ reviewId: body.reviewId as string, confirmationNonce: body.confirmationNonce as string, manifestHash: body.manifestHash as string })) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/reviews/commit") {
        const body = await readBody(request); if (!isRecord(body)) throw new HttpProblem(400, "invalid_input", "The disposition is invalid.");
        json(response, 200, { ok: true, value: resultValue(opened.core.commitResearchRoomDisposition({ projectId: opened.project.id, reviewId: body.reviewId as string, authorityNonce: body.authorityNonce as string, expectedStateBinding: body.expectedStateBinding as never, disposition: body.disposition as never, reason: body.reason as string, ...(typeof body.modifiedProposal === "string" ? { modifiedProposal: body.modifiedProposal } : {}), ...(typeof body.redirectQuestion === "string" ? { redirectQuestion: body.redirectQuestion } : {}), actor: USER })) }); return;
      }
      const rollback = /^\/api\/receipts\/(rrcp_[0-9A-HJKMNP-TV-Z]{26})\/rollback$/u.exec(url.pathname);
      if (request.method === "POST" && rollback?.[1]) {
        const body = await readBody(request); if (!isRecord(body)) throw new HttpProblem(400, "invalid_input", "The rollback request is invalid.");
        json(response, 200, { ok: true, value: resultValue(opened.core.rollbackResearchRoomReceipt({ projectId: opened.project.id, receiptId: rollback[1], expectedVersion: body.expectedVersion as number, reason: body.reason as string, actor: USER })) }); return;
      }
      const download = /^\/api\/receipts\/(rrcp_[0-9A-HJKMNP-TV-Z]{26})\/download$/u.exec(url.pathname);
      if (request.method === "GET" && download?.[1]) {
        this.authorize(request);
        const receipt = resultValue(opened.core.listResearchRoomReceipts(opened.project.id)).find((item) => item.id === download[1]);
        if (receipt === undefined) throw new HttpProblem(404, "not_found", "The receipt was not found.");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${receipt.id}.json"`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        response.end(`${JSON.stringify(receipt, null, 2)}\n`);
        return;
      }
      throw new HttpProblem(404, "not_found", "The local endpoint was not found.");
    } catch (error) {
      const problem = publicError(error); json(response, problem.status, problem.body);
    }
  }
}

export function createResearchRoomServer(options: ResearchRoomServerOptions = {}): { readonly application: ResearchRoomHttpApplication; readonly server: Server; start(): Promise<RunningResearchRoomServer> } {
  const host = options.host ?? LOOPBACK;
  if (host !== LOOPBACK) throw new Error("Research Room must bind to 127.0.0.1.");
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid Research Room port.");
  const application = new ResearchRoomHttpApplication(
    options.provider,
    options.correctionAppealSecondOpinionProvider,
    options.deliberationParticipantProviders,
    options.providerTimeoutMs,
    options.correctionAppealSecondOpinionProviderTimeoutMs,
    options.deliberationParticipantProviderTimeoutMs,
    options.directoryPicker,
    options.languagePreferenceStore,
    options.providerConfigurationService,
    options.secondOpinionProviderConfigurationService,
    options.clientAssetRoot,
    options.closedExternalAppHostRuntime,
  );
  const server = createServer((request, response) => { void application.handle(request, response); });
  server.on("clientError", (_error, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); });
  return {
    application,
    server,
    async start() {
      let address: ReturnType<Server["address"]> = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); });
        address = server.address();
        if (address !== null && typeof address !== "string" && (!BROWSER_BLOCKED_PORTS.has(address.port) || port !== 0)) break;
        await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); }));
      }
      if (address === null || typeof address === "string" || address.address !== LOOPBACK) { server.close(); application.close(); throw new Error("Research Room did not bind to loopback."); }
      if (BROWSER_BLOCKED_PORTS.has(address.port)) { server.close(); application.close(); throw new Error("Research Room selected a browser-blocked port."); }
      let closed = false;
      return Object.freeze({ origin: `http://${LOOPBACK}:${address.port}`, host: LOOPBACK, port: address.port, close: async () => { if (closed) return; closed = true; application.close(); await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); server.closeAllConnections(); }); } });
    },
  };
}
