import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request as rawRequest, type Server } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResearchRoomServer, type DirectoryPicker, type RunningResearchRoomServer } from "../src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";
import { ProviderConfigurationService, createFileProviderConfigStore } from "../src/provider-settings.js";
import {
  createStableTextSpan,
  openSestina,
  type AnalyzedResearchRoomReview,
  type CoreResult,
  type PreparedResearchRoomReview,
  type ResearchRoomProvider,
  type ResearchRoomReceipt,
  type ResearchRoomSemanticJudgeRequest,
  type ResearchRoomState,
  type SecretBackend,
} from "@sestina/core";

const RI48_USER = Object.freeze({ kind: "user" as const, actorId: "ri48-test-owner" });

function resultValue<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

class Ri48FixtureProvider implements ResearchRoomProvider {
  readonly id = "ri48-deterministic-fixture";
  readonly kind = "deterministic_fixture" as const;
  readonly networkAccess = "none" as const;
  readonly binding = Object.freeze({ id: this.id, family: "openai_compatible" as const, model: "fixture", baseUrlOrigin: "http://127.0.0.1:1", locality: "local" as const, configGeneration: 1 });
  calls = 0;

  prepare(request: ResearchRoomSemanticJudgeRequest) {
    const requestBody = JSON.stringify(request);
    return Object.freeze({ schemaVersion: "1.0.0" as const, endpoint: "http://127.0.0.1:1/v1/chat/completions", provider: this.binding, requestHash: request.requestHash, requestBody, requestBodyHash: createHash("sha256").update(requestBody).digest("hex"), requestBodyBytes: Buffer.byteLength(requestBody), responseLimitBytes: request.limits.maxResponseBytes, redirectPolicy: "error" as const, retryCount: 0 as const });
  }

  analyze(request: ResearchRoomSemanticJudgeRequest): Promise<unknown> {
    this.calls += 1;
    const span = createStableTextSpan(request.context.suggestionDocument, 0, request.context.suggestionDocument.normalizedText.length);
    if (!span.ok) return Promise.reject(new Error(span.error.code));
    return Promise.resolve({
      schemaVersion: "1.0.0",
      protocolVersion: request.protocol.version, protocolHash: request.protocol.hash,
      promptVersion: request.prompt.version, promptHash: request.prompt.hash,
      rubricVersion: request.rubric.version, rubricHash: request.rubric.hash,
      reviewId: request.reviewId, projectId: request.projectId, stateBindingHash: request.stateBindingHash, requestHash: request.requestHash, provider: request.provider,
      assessments: request.criteria.map((criterion) => ({ criterionId: criterion.id, verdict: criterion.id === "argument-delta" ? "positive" : "negative", evidenceSpans: [span.value], referencedDecisionIds: [], referencedIssueIds: [], publicRationale: criterion.id === "argument-delta" ? "Adds a bounded uncertainty statement." : `No ${criterion.positiveMeaning} is present.`, minimalCorrection: "No correction is proposed.", uncertainty: "No material uncertainty in the cited span.", missingContext: [] })),
    });
  }
}

class CancellableProvider extends Ri48FixtureProvider {
  readonly started: Promise<void>;
  private markStarted!: () => void;
  aborted = false;

  constructor() {
    super();
    this.started = new Promise((resolve) => { this.markStarted = resolve; });
  }

  override analyze(_request: ResearchRoomSemanticJudgeRequest, _preview: unknown, options: { readonly signal: AbortSignal }): Promise<unknown> {
    this.calls += 1;
    this.markStarted();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        this.aborted = true;
        reject(Object.assign(new Error("provider_aborted"), { code: "provider_aborted" }));
      }, { once: true });
    });
  }
}

class MemoryLanguagePreferenceStore implements LanguagePreferenceStore {
  writes = 0;
  constructor(public language: AppLanguage | undefined, private readonly failWrites = false) {}
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve(this.language); }
  writeLanguage(language: AppLanguage): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error("private path must not escape"));
    this.writes += 1; this.language = language; return Promise.resolve();
  }
}

async function createRi48Project(): Promise<{
  readonly root: string;
  readonly projectId: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri48-room-server-"));
  const stateDir = join(root, ".sestina");
  await mkdir(stateDir);
  const opened = resultValue(await openSestina({ databasePath: join(stateDir, "state.sqlite") }));
  const project = resultValue(opened.initializeProject({
    title: "RI-48 Synthetic Research Room",
    rootPath: ".",
    actor: RI48_USER,
  }));
  resultValue(opened.activateBrief({
    projectId: project.id,
    actor: RI48_USER,
    projectQuestion: "How should a synthetic observational association be reported?",
    currentStage: "revision",
    currentTask: "Add one evidence-bounded qualification.",
    targetArtifacts: [],
    fixedDecisions: [{
      statement: "Do not infer causality from the synthetic design.",
      scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] },
    }],
    allowedChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "synthetic" }, operations: ["delete"] }],
    expectedDeltas: [{
      statement: "Add one bounded qualification.",
      scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["add"] },
    }],
    evidenceBoundaries: [{
      statement: "Causal effects remain unproven.",
      scope: { target: { kind: "project_path", relativePath: "synthetic" }, operations: ["rewrite"] },
      forbiddenInferenceKinds: ["causal"],
    }],
    explicitNonGoals: ["Collect external participant data", "Count fixtures as market evidence"],
  }));
  opened.close();
  await writeFile(join(stateDir, "research-brief.yaml"), "# Local projection for explicit project selection.\n", "utf8");
  return { root, projectId: project.id, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const running: RunningResearchRoomServer[] = [];
const providerServers: Server[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (running.length) await running.pop()?.close();
  while (providerServers.length) await new Promise<void>((resolve) => { providerServers.pop()?.close(() => { resolve(); }); });
  while (cleanups.length) await cleanups.pop()?.();
});

type ApiEnvelope<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message?: string } };
function apiValue<T>(body: ApiEnvelope<T>): T { if (!body.ok) throw new Error(body.error.code); return body.value; }

async function start(provider?: Ri48FixtureProvider, directoryPicker?: DirectoryPicker, languagePreferenceStore: LanguagePreferenceStore = new MemoryLanguagePreferenceStore("zh-CN"), providerConfigurationService?: ProviderConfigurationService) {
  const value = await createResearchRoomServer({ ...(provider ? { provider } : {}), ...(directoryPicker ? { directoryPicker } : {}), languagePreferenceStore, ...(providerConfigurationService ? { providerConfigurationService } : {}) }).start(); running.push(value); return value;
}
async function status(origin: string) { const response = await fetch(`${origin}/api/status`); return (await response.json() as { value: { sessionToken: string } }).value; }
async function request<T>(origin: string, token: string, path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": token }, body: JSON.stringify(body) });
  return { response, body: await response.json() as ApiEnvelope<T> };
}

describe("RI-48 loopback Research Room", () => {
  it("manages one App-level openai_compatible Provider without testing the network or exposing its key", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-provider-server-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const values = new Map<string, string>();
    const secrets: SecretBackend = {
      get: (ref) => Promise.resolve(values.get(ref)),
      set: (ref, value) => { values.set(ref, value); return Promise.resolve(); },
      delete: (ref) => { values.delete(ref); return Promise.resolve(); },
      describe: (ref) => Promise.resolve({ configured: values.has(ref) }),
      health: () => Promise.resolve({ available: true, backend: "dpapi" }),
    };
    const providerSettings = new ProviderConfigurationService(createFileProviderConfigStore({ filePath: join(root, "provider.json") }), secrets);
    const server = await start(undefined, undefined, new MemoryLanguagePreferenceStore("en"), providerSettings); const session = await status(server.origin);
    expect(await (await fetch(`${server.origin}/api/provider`)).json()).toMatchObject({ ok: true, value: { mode: "offline_ledger", secretConfigured: false } });

    const saved = await request<unknown>(server.origin, session.sessionToken, "/api/provider", { providerId: "external-judge", baseUrl: "https://models.example.test/v1", model: "judge-model", timeoutMs: 10_000, maxOutputTokens: 2_000, apiKey: "server-test-key-must-stay-secret" });
    expect(saved.body).toMatchObject({ ok: true, value: { mode: "configured", secretConfigured: true, config: { family: "openai_compatible", locality: "external", generation: 1 }, projectReopenRequired: false } });
    expect(JSON.stringify(saved.body)).not.toContain("server-test-key-must-stay-secret");
    expect(await readFile(join(root, "provider.json"), "utf8")).not.toContain("server-test-key-must-stay-secret");

    const deletedConfig = await fetch(`${server.origin}/api/provider/config`, { method: "DELETE", headers: { "x-sestina-session": session.sessionToken } });
    expect(await deletedConfig.json()).toMatchObject({ ok: true, value: { mode: "offline_ledger", secretConfigured: true } });
    const deletedSecret = await fetch(`${server.origin}/api/provider/secret`, { method: "DELETE", headers: { "x-sestina-session": session.sessionToken } });
    expect(await deletedSecret.json()).toMatchObject({ ok: true, value: { mode: "offline_ledger", secretConfigured: false } });
  });

  it("runs the confirmed Manifest through one real loopback HTTP request, strict parsing, Kernel derivation, and owner commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-provider-loopback-integration-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    let calls = 0; let authorization: string | undefined;
    const semanticFixture = new Ri48FixtureProvider();
    const providerServer = createHttpServer((incoming, response) => {
      calls += 1; authorization = incoming.headers.authorization;
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      incoming.on("end", () => {
        void (async () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: { role: string; content: string }[] };
          const wrapper = JSON.parse(body.messages.find((message) => message.role === "user")?.content ?? "{}") as { request: ResearchRoomSemanticJudgeRequest };
          const result = await semanticFixture.analyze(wrapper.request);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(result) }, finish_reason: "stop" }], rawCanary: "raw-envelope-must-not-persist" }));
        })().catch(() => { response.writeHead(500); response.end(); });
      });
    });
    providerServers.push(providerServer); providerServer.listen(0, "127.0.0.1"); await once(providerServer, "listening");
    const address = providerServer.address();
    if (address === null || typeof address === "string") throw new Error("loopback Provider address unavailable");

    const secrets: SecretBackend = {
      get: () => Promise.resolve(undefined), set: () => Promise.resolve(), delete: () => Promise.resolve(),
      describe: () => Promise.resolve({ configured: false }), health: () => Promise.resolve({ available: true, backend: "dpapi" }),
    };
    const providerSettings = new ProviderConfigurationService(createFileProviderConfigStore({ filePath: join(root, "provider.json") }), secrets);
    await providerSettings.save({ providerId: "loopback-judge", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "synthetic-loopback-model", timeoutMs: 5_000 });
    const fixture = await createRi48Project(); cleanups.push(() => fixture.cleanup());
    const server = await start(undefined, undefined, new MemoryLanguagePreferenceStore("en"), providerSettings); const session = await status(server.origin);
    await request<unknown>(server.origin, session.sessionToken, "/api/project/open", { projectPath: fixture.root });
    const prepared = apiValue((await request<PreparedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/prepare", { suggestion: "Add one bounded synthetic uncertainty statement.", evidenceClass: "synthetic_fixture" })).body);
    expect(calls).toBe(0);
    expect(prepared.manifest).toMatchObject({ providerKind: "local", networkRequired: true, networkUsed: false, sendStatus: "not_sent", semanticJudge: { provider: { id: "loopback-judge", locality: "local" }, request: { retryCount: 0, redirectPolicy: "error" } } });
    const analyzed = apiValue((await request<AnalyzedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/analyze", { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash })).body);
    expect(calls).toBe(1); expect(authorization).toBeUndefined();
    expect(analyzed).toMatchObject({ providerStatus: "semantic_ready", manifest: { sendStatus: "sent_to_provider", networkUsed: true }, semanticJudge: { reasonableIncrement: { status: "supported", authority: "system_derived", canMutateAuthority: false } } });
    expect(JSON.stringify(analyzed)).not.toContain("raw-envelope-must-not-persist");
    const receipt = apiValue((await request<ResearchRoomReceipt>(server.origin, session.sessionToken, "/api/reviews/commit", { projectId: fixture.projectId, reviewId: analyzed.reviewId, authorityNonce: analyzed.authorityNonce, expectedStateBinding: analyzed.stateBinding, disposition: "accepted", reason: "Owner accepts the synthetic loopback result." })).body);
    expect(receipt).toMatchObject({ providerStatus: "semantic_ready", authority: { actor: { kind: "user" } }, semanticJudge: { derivation: "system_derived_from_validated_assessments" } });
    expect(JSON.stringify(receipt)).not.toContain("raw-envelope-must-not-persist");
  });

  it("requires an explicit first-run language, persists only zh-CN or en, and restores it after server restart", async () => {
    const preferences = new MemoryLanguagePreferenceStore(undefined);
    const server = await start(undefined, undefined, preferences); const session = await status(server.origin);
    const initialStatus = await (await fetch(`${server.origin}/api/status`)).json();
    expect(initialStatus).toMatchObject({ ok: true, value: { languagePreference: null } });

    const blocked = await request<unknown>(server.origin, session.sessionToken, "/api/project/open", { projectPath: "C:\\not-opened" });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toMatchObject({ ok: false, error: { code: "language_preference_required" } });
    const unauthorized = await fetch(`${server.origin}/api/preferences/language`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "en" }) });
    expect(unauthorized.status).toBe(403);
    const invalid = await request<unknown>(server.origin, session.sessionToken, "/api/preferences/language", { language: "fr" });
    expect(invalid.response.status).toBe(400);
    expect(preferences.writes).toBe(0);

    const selected = await request<{ readonly language: AppLanguage }>(server.origin, session.sessionToken, "/api/preferences/language", { language: "en" });
    expect(apiValue(selected.body)).toEqual({ language: "en" });
    expect(preferences).toMatchObject({ language: "en", writes: 1 });
    await server.close(); running.pop();

    const restarted = await start(undefined, undefined, preferences);
    expect(await (await fetch(`${restarted.origin}/api/status`)).json()).toMatchObject({ ok: true, value: { languagePreference: "en" } });
  });

  it("keeps first-run visible and returns a path-free stable error when language persistence fails", async () => {
    const preferences = new MemoryLanguagePreferenceStore(undefined, true);
    const server = await start(undefined, undefined, preferences); const session = await status(server.origin);
    const failed = await request<unknown>(server.origin, session.sessionToken, "/api/preferences/language", { language: "zh-CN" });
    expect(failed.response.status).toBe(503);
    expect(failed.body).toMatchObject({ ok: false, error: { code: "language_preference_write_failed" } });
    expect(JSON.stringify(failed.body)).not.toContain("private path");
    expect(await (await fetch(`${server.origin}/api/status`)).json()).toMatchObject({ ok: true, value: { languagePreference: null } });
  });

  it("refuses a non-loopback bind and rejects non-loopback Host headers", async () => {
    expect(() => createResearchRoomServer({ host: "0.0.0.0" })).toThrow(/127\.0\.0\.1/u);
    const server = await start();
    const statusCode = await new Promise<number>((resolve, reject) => {
      const call = rawRequest(`${server.origin}/api/status`, { headers: { host: "research.example" } }, (response) => { response.resume(); resolve(response.statusCode ?? 0); });
      call.once("error", reject); call.end();
    });
    expect(statusCode).toBe(421);
  });

  it("opens only the explicitly selected initialized project without returning or persisting its path", async () => {
    const fixture = await createRi48Project(); cleanups.push(() => fixture.cleanup());
    const server = await start(); const session = await status(server.origin);
    const denied = await fetch(`${server.origin}/api/project/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectPath: fixture.root }) });
    expect(denied.status).toBe(403);
    const opened = await request<{ readonly project: { readonly id: string }; readonly localOnly: boolean; readonly pathPersisted: boolean; readonly directoryScanPerformed: boolean }>(server.origin, session.sessionToken, "/api/project/open", { projectPath: fixture.root });
    expect(opened.body).toMatchObject({ ok: true, value: { project: { id: fixture.projectId }, localOnly: true, pathPersisted: false, directoryScanPerformed: false } });
    expect(JSON.stringify(opened.body)).not.toContain(fixture.root);
  });

  it("initializes an explicitly selected plain directory and activates its first Brief entirely through the browser API", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-browser-init-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const canaryPath = join(root, "existing-research-canary.txt");
    await writeFile(canaryPath, "existing research bytes must survive\n", "utf8");
    const server = await start(); const session = await status(server.origin);

    const unconfirmed = await request<unknown>(server.origin, session.sessionToken, "/api/project/open", { projectPath: root });
    expect(unconfirmed.response.status).toBe(409);
    expect(unconfirmed.body).toMatchObject({ ok: false, error: { code: "initialization_confirmation_required" } });
    expect(await readdir(root)).toEqual(["existing-research-canary.txt"]);

    const opened = await request<{
      readonly project: { readonly id: string; readonly title: string };
      readonly initialized: boolean;
      readonly setupRequired: boolean;
      readonly directoryScanPerformed: boolean;
      readonly pathPersisted: boolean;
    }>(server.origin, session.sessionToken, "/api/project/open", { projectPath: root, initializeIfNeeded: true });
    const openedValue = apiValue(opened.body);
    expect(openedValue).toMatchObject({ initialized: true, setupRequired: true, directoryScanPerformed: false, pathPersisted: false });
    expect(JSON.stringify(opened.body)).not.toContain(root);
    expect((await readdir(join(root, ".sestina"))).sort()).toEqual(expect.arrayContaining(["gitignore-suggestion.txt", "research-brief.yaml", "state.sqlite"]));
    expect(await readFile(canaryPath, "utf8")).toBe("existing research bytes must survive\n");

    const beforeSetup = await fetch(`${server.origin}/api/state`);
    expect(beforeSetup.status).toBe(409);
    expect(await beforeSetup.json()).toMatchObject({ ok: false, error: { code: "brief_setup_required" } });

    const invalidBrief = await request<unknown>(server.origin, session.sessionToken, "/api/project/brief", { projectQuestion: "", currentTask: "" });
    expect(invalidBrief.response.status).toBe(400);
    expect(invalidBrief.body).toMatchObject({ ok: false, error: { code: "invalid_input" } });

    const activated = await request<ResearchRoomState>(server.origin, session.sessionToken, "/api/project/brief", {
      projectQuestion: "How should this explicitly selected local project be studied?",
      currentTask: "Define the first evidence-bounded research step.",
    });
    expect(apiValue(activated.body)).toMatchObject({
      project: { id: openedValue.project.id },
      brief: {
        projectQuestion: "How should this explicitly selected local project be studied?",
        currentTask: "Define the first evidence-bounded research step.",
      },
    });
    expect(await readFile(canaryPath, "utf8")).toBe("existing research bytes must survive\n");
    expect(await readFile(join(root, ".sestina", "research-brief.yaml"), "utf8")).toContain("How should this explicitly selected local project be studied?");
  });

  it("uses an injected native directory picker as the primary mode without returning the selected path", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-native-picker-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const canary = join(root, "existing-research-canary.txt");
    await writeFile(canary, "unchanged by native selection\n", "utf8");
    let calls = 0;
    const directoryPicker: DirectoryPicker = { pick: () => { calls += 1; return Promise.resolve(root); } };
    const server = await start(undefined, directoryPicker); const session = await status(server.origin);

    const denied = await fetch(`${server.origin}/api/project/select-directory`, { method: "POST" });
    expect(denied.status).toBe(403);
    const selected = await request<{
      readonly selected: boolean;
      readonly initialized: boolean;
      readonly setupRequired: boolean;
      readonly directoryScanPerformed: boolean;
      readonly pathPersisted: boolean;
    }>(server.origin, session.sessionToken, "/api/project/select-directory", {});

    expect(calls).toBe(1);
    expect(apiValue(selected.body)).toMatchObject({ selected: true, initialized: true, setupRequired: true, directoryScanPerformed: false, pathPersisted: false });
    expect(JSON.stringify(selected.body)).not.toContain(root);
    expect(await readFile(canary, "utf8")).toBe("unchanged by native selection\n");
  });

  it("treats native picker cancellation as a zero-write outcome and reports picker availability", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-picker-cancel-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const server = await start(undefined, { pick: () => Promise.resolve(undefined) }); const session = await status(server.origin);

    const statusResponse = await fetch(`${server.origin}/api/status`);
    expect(await statusResponse.json()).toMatchObject({ ok: true, value: { directoryPickerAvailable: true } });
    const cancelled = await request<{ readonly selected: boolean }>(server.origin, session.sessionToken, "/api/project/select-directory", {});
    expect(apiValue(cancelled.body)).toEqual({ selected: false });
    expect(await readdir(root)).toEqual([]);
  });

  it("allows only one native picker at a time and leaves the first request cancellable", async () => {
    let pickerStarted!: () => void;
    let resolvePicker!: (value: undefined) => void;
    const started = new Promise<void>((resolve) => { pickerStarted = resolve; });
    const selected = new Promise<undefined>((resolve) => { resolvePicker = resolve; });
    const server = await start(undefined, { pick: () => { pickerStarted(); return selected; } });
    const session = await status(server.origin);

    const first = request<{ readonly selected: boolean }>(server.origin, session.sessionToken, "/api/project/select-directory", {});
    await started;
    const overlapping = await request<unknown>(server.origin, session.sessionToken, "/api/project/select-directory", {});
    expect(overlapping.response.status).toBe(409);
    expect(overlapping.body).toMatchObject({ ok: false, error: { code: "directory_picker_busy" } });

    resolvePicker(undefined);
    expect(apiValue((await first).body)).toEqual({ selected: false });
  });

  it("lets the Start Center explicitly abort a slow native picker without project writes", async () => {
    let pickerStarted!: () => void;
    const started = new Promise<void>((resolve) => { pickerStarted = resolve; });
    let observedSignal: AbortSignal | undefined;
    const server = await start(undefined, {
      pick: (signal) => {
        observedSignal = signal;
        pickerStarted();
        return new Promise<undefined>((_resolve, reject) => {
          signal.addEventListener("abort", () => { reject(new Error("cancelled")); }, { once: true });
        });
      },
    });
    const session = await status(server.origin);

    const first = request<unknown>(server.origin, session.sessionToken, "/api/project/select-directory/preview", {});
    await started;
    const cancellationResponse = await fetch(`${server.origin}/api/project/select-directory`, {
      method: "DELETE",
      headers: { "x-sestina-session": session.sessionToken },
    });
    expect(cancellationResponse.status).toBe(200);
    await expect(cancellationResponse.json()).resolves.toEqual({
      ok: true,
      value: { cancelRequested: true },
    });
    expect(observedSignal?.aborted).toBe(true);

    const cancelled = await first;
    expect(cancelled.response.status).toBe(409);
    expect(cancelled.body).toMatchObject({ ok: false, error: { code: "directory_picker_cancelled" } });
  });

  it("keeps manual mode available when no native directory picker is configured", async () => {
    const server = await start(); const session = await status(server.origin);
    const statusResponse = await fetch(`${server.origin}/api/status`);
    expect(await statusResponse.json()).toMatchObject({ ok: true, value: { directoryPickerAvailable: false } });
    const unavailable = await request<unknown>(server.origin, session.sessionToken, "/api/project/select-directory", {});
    expect(unavailable.response.status).toBe(501);
    expect(unavailable.body).toMatchObject({ ok: false, error: { code: "directory_picker_unavailable" } });
  });

  it("preserves a foreign or partial .sestina directory instead of overwriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-ri48-foreign-state-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const stateDir = join(root, ".sestina"); await mkdir(stateDir);
    const sentinel = join(stateDir, "foreign.txt"); await writeFile(sentinel, "foreign bytes\n", "utf8");
    const server = await start(); const session = await status(server.origin);

    const opened = await request<unknown>(server.origin, session.sessionToken, "/api/project/open", { projectPath: root, initializeIfNeeded: true });
    expect(opened.response.status).toBe(409);
    expect(opened.body).toMatchObject({ ok: false, error: { code: "state_conflict" } });
    expect(await readdir(stateDir)).toEqual(["foreign.txt"]);
    expect(await readFile(sentinel, "utf8")).toBe("foreign bytes\n");
  });

  it("shows the exact unsent Manifest before invoking the Provider, then commits only on a separate owner action", async () => {
    const fixture = await createRi48Project(); cleanups.push(() => fixture.cleanup());
    const provider = new Ri48FixtureProvider(); const server = await start(provider); const session = await status(server.origin);
    await request<unknown>(server.origin, session.sessionToken, "/api/project/open", { projectPath: fixture.root });
    const prepared = await request<PreparedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/prepare", { suggestion: "Add a bounded synthetic qualification.", evidenceClass: "synthetic_fixture" });
    const preparedValue = apiValue(prepared.body);
    expect(provider.calls).toBe(0);
    expect(preparedValue).toMatchObject({ contextManifestVisible: true, manifest: { sendStatus: "not_sent", networkUsed: false, countsAsExternalEvidence: false } });
    const analysis = await request<AnalyzedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/analyze", { reviewId: preparedValue.reviewId, confirmationNonce: preparedValue.confirmationNonce, manifestHash: preparedValue.manifestHash });
    const analysisValue = apiValue(analysis.body);
    expect(provider.calls).toBe(1);
    expect(analysisValue).toMatchObject({ providerStatus: "semantic_ready", manifest: { sendStatus: "sent_to_provider", networkUsed: false } });
    const beforeCommit = await (await fetch(`${server.origin}/api/state`)).json() as ApiEnvelope<ResearchRoomState>;
    expect(apiValue(beforeCommit).receipts).toHaveLength(0);
    const committed = await request<ResearchRoomReceipt>(server.origin, session.sessionToken, "/api/reviews/commit", { projectId: fixture.projectId, reviewId: analysisValue.reviewId, authorityNonce: analysisValue.authorityNonce, expectedStateBinding: analysisValue.stateBinding, disposition: "accepted", reason: "The owner accepts this bounded synthetic increment." });
    expect(apiValue(committed.body)).toMatchObject({ disposition: { kind: "accepted", reason: "The owner accepts this bounded synthetic increment." }, evidenceClass: "synthetic_fixture", countsAsExternalEvidence: false, authority: { actor: { kind: "user" } } });
  });

  it("cancels an in-flight analysis through the loopback API without partial state", async () => {
    const fixture = await createRi48Project(); cleanups.push(() => fixture.cleanup());
    const provider = new CancellableProvider(); const server = await start(provider); const session = await status(server.origin);
    await request<unknown>(server.origin, session.sessionToken, "/api/project/open", { projectPath: fixture.root });
    const prepared = apiValue((await request<PreparedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/prepare", { suggestion: "Cancel this synthetic analysis before it produces a result.", evidenceClass: "synthetic_fixture" })).body);
    const analyzing = request<AnalyzedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/analyze", { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash });
    await provider.started;

    const cancelled = await request<{ readonly cancelled: true }>(server.origin, session.sessionToken, "/api/reviews/cancel", { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash });
    expect(cancelled.body).toEqual({ ok: true, value: { cancelled: true } });
    const analysis = await analyzing;
    expect(analysis.response.status).toBe(400);
    expect(analysis.body).toMatchObject({ ok: false, error: { code: "operation_cancelled" } });
    expect(provider.aborted).toBe(true);
    const state = await (await fetch(`${server.origin}/api/state`)).json() as ApiEnvelope<ResearchRoomState>;
    expect(apiValue(state).receipts).toHaveLength(0);
  });

  it("defaults to ledger_only and creates no Provider call or background network contract", async () => {
    const fixture = await createRi48Project(); cleanups.push(() => fixture.cleanup());
    const server = await start(); const session = await status(server.origin);
    await request<unknown>(server.origin, session.sessionToken, "/api/project/open", { projectPath: fixture.root });
    const prepared = apiValue((await request<PreparedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/prepare", { suggestion: "An unevaluated suggestion.", evidenceClass: "owner_scenario" })).body);
    const analysis = await request<AnalyzedResearchRoomReview>(server.origin, session.sessionToken, "/api/reviews/analyze", { reviewId: prepared.reviewId, confirmationNonce: prepared.confirmationNonce, manifestHash: prepared.manifestHash });
    const analysisValue = apiValue(analysis.body);
    expect(analysis.body).toMatchObject({ ok: true, value: { providerStatus: "ledger_only", ledgerOnlyReason: "provider_not_configured", manifest: { networkUsed: false, sendStatus: "not_sent" } } });
    const blocked = await request<ResearchRoomReceipt>(server.origin, session.sessionToken, "/api/reviews/commit", { projectId: fixture.projectId, reviewId: analysisValue.reviewId, authorityNonce: analysisValue.authorityNonce, expectedStateBinding: analysisValue.stateBinding, disposition: "accepted", reason: "Must fail closed." });
    expect(blocked.response.status).toBe(400); expect(blocked.body.ok ? "unexpected_success" : blocked.body.error.code).toBe("review_blocked");
  });
});
