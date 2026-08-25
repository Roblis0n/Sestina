import { randomBytes } from "node:crypto";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openSestina,
  coreErr,
  coreOk,
  type BriefProjectionPublisher,
  type CoreResult,
  type ResearchRoomProvider,
  type SestinaCore,
} from "@sestina/core";
import { isAppLanguage, type LanguagePreferenceStore } from "./language-preferences.js";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { ProviderSettingsError, type ProviderConfigurationService, type SaveOpenAICompatibleProviderInput } from "./provider-settings.js";

const LOOPBACK = "127.0.0.1";
const BODY_LIMIT = 65_536;
const BROWSER_BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
const USER = Object.freeze({ kind: "user" as const, actorId: "local-research-owner" });
const CSP = "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'";
const DEFAULT_CLIENT_ASSET_ROOT = resolve(fileURLToPath(new URL("../dist/client", import.meta.url)));

export interface ResearchRoomServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly provider?: ResearchRoomProvider;
  readonly providerTimeoutMs?: number;
  readonly directoryPicker?: DirectoryPicker;
  readonly languagePreferenceStore?: LanguagePreferenceStore;
  readonly providerConfigurationService?: ProviderConfigurationService;
  readonly clientAssetRoot?: string;
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
function resultValue<T>(result: CoreResult<T>): T {
  if (result.ok) return result.value;
  const status = result.error.code === "not_found" ? 404 : result.error.code === "stale_state" || result.error.code === "state_conflict" ? 409 : result.error.code === "infrastructure_failure" || result.error.code === "projection_write_failure" ? 503 : 400;
  throw new HttpProblem(status, result.error.code, result.error.message);
}

function authorityResultValue<T>(result: CoreResult<T>): T {
  if (!result.ok && result.error.code === "state_conflict") throw new HttpProblem(409, "invalid_transition", "The authority transition is not legal for the current object state.");
  return resultValue(result);
}

function workspaceResultValue<T>(result: CoreResult<T>): T {
  if (!result.ok && result.error.code === "infrastructure_failure") throw new HttpProblem(503, "storage_unavailable", "The local structured research state is unavailable.");
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

export class ResearchRoomHttpApplication {
  readonly sessionToken = randomBytes(32).toString("hex");
  #opened: OpenedProject | undefined;
  #pickerAbort: AbortController | undefined;
  #pendingInitialization: PendingProjectInitialization | undefined;

  constructor(
    private readonly provider?: ResearchRoomProvider,
    private readonly providerTimeoutMs = 15_000,
    private readonly directoryPicker?: DirectoryPicker,
    private readonly languagePreferenceStore?: LanguagePreferenceStore,
    private readonly providerConfigurationService?: ProviderConfigurationService,
    private readonly clientAssetRoot = DEFAULT_CLIENT_ASSET_ROOT,
  ) {}

  close(): void { this.#pickerAbort?.abort(); this.#pickerAbort = undefined; this.#pendingInitialization = undefined; this.#opened?.core.close(); this.#opened = undefined; }

  private requireOpened(): OpenedProject {
    if (this.#opened === undefined) throw new HttpProblem(409, "project_not_open", "Open an initialized Sestina project first.");
    return this.#opened;
  }

  private authorize(request: IncomingMessage): void {
    if (request.headers["x-sestina-session"] !== this.sessionToken) throw new HttpProblem(403, "explicit_action_required", "This action requires the active local session.");
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

  private async providerStatus(): Promise<unknown> {
    if (this.providerConfigurationService === undefined) return { mode: this.provider === undefined ? "offline_ledger" : "configured", injected: this.provider !== undefined };
    try { return await this.providerConfigurationService.status(); }
    catch (error) { return this.providerProblem(error); }
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

  private async initializeProject(root: string, title: string): Promise<OpenedProject> {
    const stateDirectory = join(root, ".sestina");
    const databasePath = join(stateDirectory, "state.sqlite");
    let core: SestinaCore | undefined;
    let createdStateDirectory = false;
    try {
      await mkdir(stateDirectory);
      createdStateDirectory = true;
      const provider = await this.configuredProvider();
      core = resultValue(await openSestina({ databasePath, ...(provider ? { researchRoomProvider: provider } : {}), researchRoomProviderTimeoutMs: this.providerTimeoutMs }));
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
      const provider = await this.configuredProvider();
      const core = resultValue(await openSestina({ databasePath, ...(provider ? { researchRoomProvider: provider } : {}), researchRoomProviderTimeoutMs: this.providerTimeoutMs }));
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
    return { project: next.project, initialized, setupRequired: brief === undefined, localOnly: true, pathPersisted: false, directoryScanPerformed: false };
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
    return { project: next.project, initialized: true, setupRequired: brief === undefined, localOnly: true, pathPersisted: false, directoryScanPerformed: false };
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
        json(response, 200, { ok: true, value: { localOnly: true, telemetry: false, projectOpen: this.#opened !== undefined, projectSetupRequired: this.#opened !== undefined && brief === undefined, ...(this.#opened ? { project: this.#opened.project } : {}), directoryPickerAvailable: this.directoryPicker !== undefined, languagePreference: languagePreference ?? null, sessionToken: this.sessionToken } }); return;
      }

      if (request.method === "POST" || request.method === "DELETE") this.authorize(request);
      if (request.method === "POST" && url.pathname === "/api/preferences/language") { json(response, 200, { ok: true, value: await this.setLanguagePreference(await readBody(request)) }); return; }
      await this.requireLanguagePreference();
      if (request.method === "GET" && url.pathname === "/api/provider") { json(response, 200, { ok: true, value: await this.providerStatus() }); return; }
      if (request.method === "POST" && url.pathname === "/api/provider") { json(response, 200, { ok: true, value: await this.saveProvider(await readBody(request)) }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/provider/config") { json(response, 200, { ok: true, value: await this.deleteProviderConfig() }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/provider/secret") { json(response, 200, { ok: true, value: await this.deleteProviderSecret() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/select-directory/preview") { json(response, 200, { ok: true, value: await this.previewSelectedDirectory() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/initialize-selected") { json(response, 200, { ok: true, value: await this.initializeSelectedDirectory(await readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/select-directory") { json(response, 200, { ok: true, value: await this.selectDirectory() }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/project/select-directory") { json(response, 200, { ok: true, value: this.cancelDirectoryPicker() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/open") { json(response, 200, { ok: true, value: await this.openProject(await readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/brief") { json(response, 200, { ok: true, value: await this.activateInitialBrief(await readBody(request)) }); return; }
      const opened = this.requireOpened();
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
      });
      if (request.method === "GET" && url.pathname in workspaceLists) {
        const read = workspaceLists[url.pathname as keyof typeof workspaceLists];
        const projection = read(workspaceListRequest(url)) as CoreResult<unknown>;
        json(response, 200, { ok: true, value: workspaceResultValue(projection) }); return;
      }
      const workspaceDetail = /^\/api\/project\/(decisions|issues|evidence|episodes|receipts)\/([a-z]+_[0-9A-HJKMNP-TV-Z]{26})$/u.exec(url.pathname);
      if (request.method === "GET" && workspaceDetail?.[1] && workspaceDetail[2]) {
        const id = workspaceDetail[2];
        const value = workspaceDetail[1] === "decisions" ? workspaceResultValue(opened.core.getDecisionProjection(opened.project.id, id))
          : workspaceDetail[1] === "issues" ? workspaceResultValue(opened.core.getIssueProjection(opened.project.id, id))
            : workspaceDetail[1] === "evidence" ? workspaceResultValue(opened.core.getEvidenceProjection(opened.project.id, id))
              : workspaceDetail[1] === "episodes" ? workspaceResultValue(opened.core.getEpisodeProjection(opened.project.id, id))
                : workspaceResultValue(opened.core.getReceiptProjection(opened.project.id, id));
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
        const body = await readBody(request); if (!isRecord(body)) throw new HttpProblem(400, "invalid_input", "The review request is invalid.");
        json(response, 200, { ok: true, value: resultValue(opened.core.prepareResearchRoomReview({ projectId: opened.project.id, suggestion: body.suggestion as string, evidenceClass: body.evidenceClass as never, countsAsExternalEvidence: false })) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/reviews/analyze") {
        const body = await readBody(request); if (!isRecord(body)) throw new HttpProblem(400, "invalid_input", "The analysis confirmation is invalid.");
        const value = await opened.core.analyzeResearchRoomSuggestion({ reviewId: body.reviewId as string, confirmationNonce: body.confirmationNonce as string, manifestHash: body.manifestHash as string });
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
  const application = new ResearchRoomHttpApplication(options.provider, options.providerTimeoutMs, options.directoryPicker, options.languagePreferenceStore, options.providerConfigurationService, options.clientAssetRoot);
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
