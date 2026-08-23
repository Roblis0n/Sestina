import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
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
async function isFile(path: string): Promise<boolean> { try { return (await stat(path)).isFile(); } catch { return false; } }
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

  constructor(private readonly provider?: ResearchRoomProvider, private readonly providerTimeoutMs = 15_000) {}

  close(): void { this.#opened?.core.close(); this.#opened = undefined; }

  private requireOpened(): OpenedProject {
    if (this.#opened === undefined) throw new HttpProblem(409, "project_not_open", "Open an initialized Sestina project first.");
    return this.#opened;
  }

  private authorize(request: IncomingMessage): void {
    if (request.headers["x-sestina-session"] !== this.sessionToken) throw new HttpProblem(403, "explicit_action_required", "This action requires the active local session.");
  }

  private async openProject(input: unknown): Promise<unknown> {
    if (!isRecord(input)) throw new HttpProblem(400, "invalid_input", "Choose an initialized Sestina project directory.");
    const projectPath = text(input.projectPath, 16_384);
    if (projectPath === undefined) throw new HttpProblem(400, "invalid_input", "Choose an initialized Sestina project directory.");
    let root: string;
    try { root = await realpath(projectPath); } catch { throw new HttpProblem(404, "project_not_found", "The selected directory is unavailable."); }
    const databasePath = join(root, ".sestina", "state.sqlite");
    const briefPath = join(root, ".sestina", "research-brief.yaml");
    if (!(await isFile(databasePath)) || !(await isFile(briefPath))) throw new HttpProblem(409, "project_not_initialized", "The selected directory is not an initialized Sestina project.");
    const opened = resultValue(await openSestina({ databasePath, ...(this.provider ? { researchRoomProvider: this.provider } : {}), researchRoomProviderTimeoutMs: this.providerTimeoutMs }));
    const projects = resultValue(opened.listProjects());
    if (projects.length !== 1 || projects[0] === undefined) { opened.close(); throw new HttpProblem(409, "state_conflict", "The selected project binding is inconsistent."); }
    this.#opened?.core.close();
    this.#opened = { root, project: { id: projects[0].id, title: projects[0].title }, core: opened };
    return { project: this.#opened.project, localOnly: true, pathPersisted: false, directoryScanPerformed: false };
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!hostAllowed(request.headers.host)) throw new HttpProblem(421, "loopback_host_required", "The Research Room accepts only loopback Host headers.");
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (request.method === "GET" && url.pathname === "/") { asset(response, "text/html; charset=utf-8", RESEARCH_ROOM_HTML); return; }
      if (request.method === "GET" && url.pathname === "/app.css") { asset(response, "text/css; charset=utf-8", RESEARCH_ROOM_CSS); return; }
      if (request.method === "GET" && url.pathname === "/app.js") { asset(response, "text/javascript; charset=utf-8", RESEARCH_ROOM_JS); return; }
      if (request.method === "GET" && url.pathname === "/api/status") { json(response, 200, { ok: true, value: { localOnly: true, telemetry: false, projectOpen: this.#opened !== undefined, sessionToken: this.sessionToken } }); return; }

      if (request.method === "POST") this.authorize(request);
      if (request.method === "POST" && url.pathname === "/api/project/open") { json(response, 200, { ok: true, value: await this.openProject(await readBody(request)) }); return; }
      const opened = this.requireOpened();
      if (request.method === "GET" && url.pathname === "/api/state") { json(response, 200, { ok: true, value: resultValue(opened.core.getResearchRoomState(opened.project.id)) }); return; }
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
  const application = new ResearchRoomHttpApplication(options.provider, options.providerTimeoutMs);
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
