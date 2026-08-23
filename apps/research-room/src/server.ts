import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  openSestina,
  type CoreResult,
  type ResearchRoomProvider,
  type SestinaCore,
} from "@sestina/core";
import { RESEARCH_ROOM_CSS, RESEARCH_ROOM_HTML, RESEARCH_ROOM_JS } from "./ui.js";

const LOOPBACK = "127.0.0.1";
const BODY_LIMIT = 65_536;
const USER = Object.freeze({ kind: "user" as const, actorId: "local-research-owner" });
const CSP = "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'";

export interface ResearchRoomServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly provider?: ResearchRoomProvider;
  readonly providerTimeoutMs?: number;
  readonly directoryPicker?: DirectoryPicker;
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

class HttpProblem extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown, maxBytes: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && Buffer.byteLength(normalized, "utf8") <= maxBytes ? normalized : undefined;
}
function resultValue<T>(result: CoreResult<T>): T {
  if (result.ok) return result.value;
  const status = result.error.code === "not_found" ? 404 : result.error.code === "stale_state" || result.error.code === "state_conflict" ? 409 : result.error.code === "infrastructure_failure" ? 503 : 400;
  throw new HttpProblem(status, result.error.code, result.error.message);
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}
function asset(response: ServerResponse, contentType: string, body: string): void {
  response.writeHead(200, { "content-type": contentType, "cache-control": "no-store", "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY" });
  response.end(body);
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

  constructor(private readonly provider?: ResearchRoomProvider, private readonly providerTimeoutMs = 15_000, private readonly directoryPicker?: DirectoryPicker) {}

  close(): void { this.#pickerAbort?.abort(); this.#pickerAbort = undefined; this.#opened?.core.close(); this.#opened = undefined; }

  private requireOpened(): OpenedProject {
    if (this.#opened === undefined) throw new HttpProblem(409, "project_not_open", "Open an initialized Sestina project first.");
    return this.#opened;
  }

  private authorize(request: IncomingMessage): void {
    if (request.headers["x-sestina-session"] !== this.sessionToken) throw new HttpProblem(403, "explicit_action_required", "This action requires the active local session.");
  }

  private async initializeProject(root: string, title: string): Promise<OpenedProject> {
    const stateDirectory = join(root, ".sestina");
    const databasePath = join(stateDirectory, "state.sqlite");
    let core: SestinaCore | undefined;
    let createdStateDirectory = false;
    try {
      await mkdir(stateDirectory);
      createdStateDirectory = true;
      core = resultValue(await openSestina({ databasePath, ...(this.provider ? { researchRoomProvider: this.provider } : {}), researchRoomProviderTimeoutMs: this.providerTimeoutMs }));
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
      const core = resultValue(await openSestina({ databasePath, ...(this.provider ? { researchRoomProvider: this.provider } : {}), researchRoomProviderTimeoutMs: this.providerTimeoutMs }));
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

  private async selectDirectory(): Promise<{ readonly selected: false } | ({ readonly selected: true } & ProjectOpenResult)> {
    if (this.directoryPicker === undefined) throw new HttpProblem(501, "directory_picker_unavailable", "The system folder picker is unavailable. Use manual path entry instead.");
    if (this.#pickerAbort !== undefined) throw new HttpProblem(409, "directory_picker_busy", "A system folder picker is already open.");
    const controller = new AbortController(); this.#pickerAbort = controller;
    try {
      let selected: string | undefined;
      try { selected = await this.directoryPicker.pick(controller.signal); }
      catch { throw new HttpProblem(502, "directory_picker_failed", "The system folder picker could not be opened. Use manual path entry instead."); }
      if (selected === undefined) return { selected: false };
      return { selected: true, ...await this.openProject({ projectPath: selected, initializeIfNeeded: true }) };
    } finally {
      if (this.#pickerAbort === controller) this.#pickerAbort = undefined;
    }
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

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!hostAllowed(request.headers.host)) throw new HttpProblem(421, "loopback_host_required", "The Research Room accepts only loopback Host headers.");
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (request.method === "GET" && url.pathname === "/") { asset(response, "text/html; charset=utf-8", RESEARCH_ROOM_HTML); return; }
      if (request.method === "GET" && url.pathname === "/app.css") { asset(response, "text/css; charset=utf-8", RESEARCH_ROOM_CSS); return; }
      if (request.method === "GET" && url.pathname === "/app.js") { asset(response, "text/javascript; charset=utf-8", RESEARCH_ROOM_JS); return; }
      if (request.method === "GET" && url.pathname === "/api/status") { json(response, 200, { ok: true, value: { localOnly: true, telemetry: false, projectOpen: this.#opened !== undefined, directoryPickerAvailable: this.directoryPicker !== undefined, sessionToken: this.sessionToken } }); return; }

      if (request.method === "POST") this.authorize(request);
      if (request.method === "POST" && url.pathname === "/api/project/select-directory") { json(response, 200, { ok: true, value: await this.selectDirectory() }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/open") { json(response, 200, { ok: true, value: await this.openProject(await readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/project/brief") { json(response, 200, { ok: true, value: await this.activateInitialBrief(await readBody(request)) }); return; }
      const opened = this.requireOpened();
      if (request.method === "GET" && url.pathname === "/api/state") {
        if (resultValue(opened.core.getBriefState(opened.project.id)) === undefined) throw new HttpProblem(409, "brief_setup_required", "Complete the initial Research Brief in this browser.");
        json(response, 200, { ok: true, value: resultValue(opened.core.getResearchRoomState(opened.project.id)) }); return;
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
  const application = new ResearchRoomHttpApplication(options.provider, options.providerTimeoutMs, options.directoryPicker);
  const server = createServer((request, response) => { void application.handle(request, response); });
  server.on("clientError", (_error, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); });
  return {
    application,
    server,
    async start() {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); });
      const address = server.address();
      if (address === null || typeof address === "string" || address.address !== LOOPBACK) { server.close(); application.close(); throw new Error("Research Room did not bind to loopback."); }
      let closed = false;
      return Object.freeze({ origin: `http://${LOOPBACK}:${address.port}`, host: LOOPBACK, port: address.port, close: async () => { if (closed) return; closed = true; application.close(); await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); server.closeAllConnections(); }); } });
    },
  };
}
