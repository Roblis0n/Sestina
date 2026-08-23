import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request as rawRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../src/server.js";
import {
  openSestina,
  type AnalyzedResearchRoomReview,
  type CoreResult,
  type PreparedResearchRoomReview,
  type ResearchRoomProvider,
  type ResearchRoomReceipt,
  type ResearchRoomState,
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
  calls = 0;

  analyze(): Promise<unknown> {
    this.calls += 1;
    return Promise.resolve({
      schemaVersion: "1.0.0",
      proposal: "A synthetic suggestion for RI-48 server verification.",
      findings: [{
        kind: "reasonable_increment",
        severity: "info",
        summary: "Adds a bounded uncertainty statement.",
        affectedDecisionIds: [],
      }],
      argumentDelta: {
        kind: "boundary_condition",
        summary: "Adds a bounded uncertainty statement.",
        genuineAdditions: ["Adds an uncertainty interval and design limitation."],
      },
      alternativeExplanations: ["A synthetic alternative explanation remains visible."],
      unknowns: ["External validity remains unknown."],
      minimalCorrection: "Keep the observational wording and add the interval.",
      unproven: ["No external participant or real second use is proven."],
    });
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
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { while (running.length) await running.pop()?.close(); while (cleanups.length) await cleanups.pop()?.(); });

type ApiEnvelope<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message?: string } };
function apiValue<T>(body: ApiEnvelope<T>): T { if (!body.ok) throw new Error(body.error.code); return body.value; }

async function start(provider?: Ri48FixtureProvider) {
  const value = await createResearchRoomServer({ ...(provider ? { provider } : {}) }).start(); running.push(value); return value;
}
async function status(origin: string) { const response = await fetch(`${origin}/api/status`); return (await response.json() as { value: { sessionToken: string } }).value; }
async function request<T>(origin: string, token: string, path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": token }, body: JSON.stringify(body) });
  return { response, body: await response.json() as ApiEnvelope<T> };
}

describe("RI-48 loopback Research Room", () => {
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
