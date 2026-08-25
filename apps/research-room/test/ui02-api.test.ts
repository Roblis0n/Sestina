import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSestina, type CoreResult } from "@sestina/core";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";

const USER = { kind: "user", actorId: "ui02-api-owner" } as const;
const roots: string[] = [];
const servers: RunningResearchRoomServer[] = [];

class LanguageStore implements LanguagePreferenceStore {
  constructor(private language: AppLanguage = "en") {}
  readLanguage(): Promise<AppLanguage | undefined> { return Promise.resolve(this.language); }
  writeLanguage(language: AppLanguage): Promise<void> { this.language = language; return Promise.resolve(); }
}

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function createProject(title = "UI-02 API Project") {
  const root = await mkdtemp(join(tmpdir(), "sestina-ui02-api-")); roots.push(root);
  const state = join(root, ".sestina"); await mkdir(state);
  const core = valueOf(await openSestina({ databasePath: join(state, "state.sqlite") }));
  const project = valueOf(core.initializeProject({ title, actor: USER }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id, actor: USER,
    projectQuestion: "How should durable research objects remain recoverable?",
    currentStage: "revision", currentTask: "Verify the typed UI-02 API boundary.", targetArtifacts: [],
    fixedDecisions: [{ statement: "Authority stays in Core.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "project_path", relativePath: "notes" }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "notes" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add a stable project workspace.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "No arbitrary file scan.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Cross-project search"],
  }));
  core.close();
  await writeFile(join(state, "research-brief.yaml"), "# original projection\n", "utf8");
  return { root, project, brief };
}

async function openServer(root: string) {
  const server = await createResearchRoomServer({ languagePreferenceStore: new LanguageStore() }).start(); servers.push(server);
  const status = await (await fetch(`${server.origin}/api/status`)).json() as { value: { sessionToken: string } };
  const opened = await fetch(`${server.origin}/api/project/open`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": status.value.sessionToken }, body: JSON.stringify({ projectPath: root }) });
  expect(opened.status).toBe(200);
  return { server, token: status.value.sessionToken };
}

async function command(origin: string, token: string, path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": token }, body: JSON.stringify(body) });
  return { response, body: await response.json() as { ok: boolean; value?: unknown; error?: { code: string } } };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("UI-02 loopback typed API facade", () => {
  it("serves bounded project projections without paths or low-level state", async () => {
    const state = await createProject();
    const { server } = await openServer(state.root);
    const overviewResponse = await fetch(`${server.origin}/api/project/overview`);
    const overview = await overviewResponse.json() as Record<string, unknown>;
    expect(overviewResponse.status).toBe(200);
    expect(overview).toMatchObject({ ok: true, value: { schemaVersion: "1.0.0", project: { id: state.project.id }, counts: { decisions: 0, issues: 0, evidence: 0 } } });
    expect(JSON.stringify(overview)).not.toContain(state.root);
    expect(JSON.stringify(overview)).not.toContain("state.sqlite");

    const listResponse = await fetch(`${server.origin}/api/project/decisions?limit=50`);
    expect(await listResponse.json()).toMatchObject({ ok: true, value: { schemaVersion: "1.0.0", projectId: state.project.id, items: [] } });
    const invalidLimit = await fetch(`${server.origin}/api/project/decisions?limit=5000`);
    expect(invalidLimit.status).toBe(400);
    expect(await invalidLimit.json()).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const malformedCursor = await fetch(`${server.origin}/api/project/decisions?limit=10&cursor=not-a-cursor`);
    expect(malformedCursor.status).toBe(409);
    expect(await malformedCursor.json()).toMatchObject({ ok: false, error: { code: "stale_state" } });
  });

  it("requires exact explicit confirmation and project binding for authority commands", async () => {
    const state = await createProject();
    const { server, token } = await openServer(state.root);
    const base = {
      commandType: "record_decision",
      projectId: state.project.id,
      expectedVersion: state.brief.version,
      effectiveBriefVersionId: state.brief.currentVersionId,
      statement: "Expose a proposed Decision through the shared Core.",
      scope: { kind: "project" },
      rationale: "The App must not copy the Decision state machine.",
      reopenConditions: ["The Core contract changes."],
      reason: "Record a proposal only.",
    };
    const unconfirmed = await command(server.origin, token, "/api/commands/decisions/record", { ...base, confirmed: false });
    expect(unconfirmed.response.status).toBe(400);
    expect(unconfirmed.body).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    const wrongProject = await command(server.origin, token, "/api/commands/decisions/record", { ...base, projectId: "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAV", confirmed: true });
    expect(wrongProject.response.status).toBe(409);
    expect(wrongProject.body).toMatchObject({ ok: false, error: { code: "cross_project_reference" } });
    const unknownField = await command(server.origin, token, "/api/commands/decisions/record", { ...base, confirmed: true, rawPath: state.root });
    expect(unknownField.response.status).toBe(400);
    expect(unknownField.body).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const recorded = await command(server.origin, token, "/api/commands/decisions/record", { ...base, confirmed: true });
    expect(recorded.response.status).toBe(200);
    expect(recorded.body).toMatchObject({ ok: true, value: { status: "proposed", version: 1 } });
  });

  it("exposes documented ledger filters and project-bound paged structured search", async () => {
    const state = await createProject();
    const { server, token } = await openServer(state.root);
    for (const statement of ["Paged continuity alpha", "Paged continuity beta"]) {
      const recorded = await command(server.origin, token, "/api/commands/decisions/record", {
        commandType: "record_decision", projectId: state.project.id, expectedVersion: state.brief.version,
        effectiveBriefVersionId: state.brief.currentVersionId, statement, scope: { kind: "project" },
        rationale: "Paged continuity search remains structured and project-local.", reopenConditions: [], reason: "Create a searchable proposal.", confirmed: true,
      });
      expect(recorded.response.status).toBe(200);
    }

    const filtered = await fetch(`${server.origin}/api/project/decisions?limit=50&scope=project&source=user&active=false&referencedByCurrentBrief=true`);
    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toMatchObject({ ok: true, value: { items: [{ scope: { kind: "project" }, active: false, referencedByCurrentBrief: true }, { scope: { kind: "project" }, active: false, referencedByCurrentBrief: true }] } });

    const first = await fetch(`${server.origin}/api/project/search?q=paged%20continuity&limit=1`);
    const firstBody = await first.json() as { value: { datasetVersion: string; nextCursor: string; truncated: boolean; items: { projectId: string; status: string; source: string }[] } };
    expect(first.status).toBe(200);
    expect(typeof firstBody.value.datasetVersion).toBe("string");
    expect(typeof firstBody.value.nextCursor).toBe("string");
    expect(firstBody.value).toMatchObject({ truncated: true, items: [{ projectId: state.project.id, status: "proposed", source: "user_recorded:user" }] });
    const next = await fetch(`${server.origin}/api/project/search?q=paged%20continuity&limit=1&cursor=${encodeURIComponent(firstBody.value.nextCursor)}`);
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ ok: true, value: { items: [expect.objectContaining({ projectId: state.project.id })], truncated: false } });
    const wrongQuery = await fetch(`${server.origin}/api/project/search?q=changed&limit=1&cursor=${encodeURIComponent(firstBody.value.nextCursor)}`);
    expect(wrongQuery.status).toBe(409);
    expect(await wrongQuery.json()).toMatchObject({ ok: false, error: { code: "stale_state" } });
  });

  it("maps stale, illegal, evidence-less, and unconfirmed commands to stable safe errors", async () => {
    const state = await createProject();
    const core = valueOf(await openSestina({ databasePath: join(state.root, ".sestina", "state.sqlite") }));
    const artifact = valueOf(core.createArtifactWithInitialRevision({ projectId: state.project.id, actor: USER, kind: "research_note", relativePath: "notes/error-boundary.md", content: "Canonical issue source", mediaType: "text/markdown" }));
    const issue = valueOf(core.openIssue({ projectId: state.project.id, actor: USER, kind: "evidence_boundary", target: { kind: "artifact", artifactId: artifact.artifact.id }, violatedCriterion: "canonical-evidence", rationaleConcepts: ["provenance"], summary: "Resolution requires canonical Evidence.", sourceArtifactId: artifact.artifact.id, sourceRevisionId: artifact.revision.id, sourceRevisionContentHash: artifact.revision.content.contentHash, lineageRootRevisionId: artifact.revision.id }));
    core.close();
    const { server, token } = await openServer(state.root);
    const recorded = await command(server.origin, token, "/api/commands/decisions/record", { commandType: "record_decision", projectId: state.project.id, expectedVersion: state.brief.version, effectiveBriefVersionId: state.brief.currentVersionId, statement: "A proposed Decision for error-boundary checks.", scope: { kind: "project" }, rationale: "Core remains authoritative.", reopenConditions: [], reason: "Create one proposal.", confirmed: true });
    const decision = recorded.body.value as { id: string; version: number };

    const illegal = await command(server.origin, token, "/api/commands/decisions/transition", { commandType: "transition_decision", projectId: state.project.id, decisionId: decision.id, expectedVersion: decision.version, target: "frozen", reason: "A proposed Decision cannot be frozen.", confirmed: true });
    expect(illegal.response.status).toBe(409);
    expect(illegal.body).toMatchObject({ ok: false, error: { code: "invalid_transition" } });
    const stale = await command(server.origin, token, "/api/commands/decisions/transition", { commandType: "transition_decision", projectId: state.project.id, decisionId: decision.id, expectedVersion: decision.version + 10, target: "accepted", reason: "Reject stale authority state.", confirmed: true });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toMatchObject({ ok: false, error: { code: "stale_state" } });
    const noEvidence = await command(server.origin, token, "/api/commands/issues/resolve", { commandType: "resolve_issue", projectId: state.project.id, issueId: issue.id, expectedVersion: issue.version, resolutionEvidenceId: "revd_01ARZ3NDEKTSV4RRFFQ69G5FAV", reason: "A made-up Evidence ID must fail.", confirmed: true });
    expect(noEvidence.response.status).toBe(400);
    expect(noEvidence.body).toMatchObject({ ok: false, error: { code: "evidence_required" } });
    const unconfirmedRollback = await command(server.origin, token, "/api/commands/receipts/rollback", { commandType: "rollback_receipt", projectId: state.project.id, receiptId: "rrcp_01ARZ3NDEKTSV4RRFFQ69G5FAV", expectedVersion: 1, reason: "No confirmation.", confirmed: false });
    expect(unconfirmedRollback.response.status).toBe(400);
    expect(unconfirmedRollback.body).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    const serialized = JSON.stringify([illegal.body, stale.body, noEvidence.body, unconfirmedRollback.body]);
    expect(serialized).not.toContain(state.root);
    expect(serialized).not.toMatch(/SQLITE|stack|state\.sqlite/iu);
  });

  it("keeps Brief candidate save separate and publishes the activated YAML", async () => {
    const state = await createProject();
    const { server, token } = await openServer(state.root);
    const candidate = await command(server.origin, token, "/api/commands/brief/candidate", {
      commandType: "propose_brief_change", projectId: state.project.id, expectedVersion: state.brief.version,
      changes: { currentTask: "Activate only after a second explicit command." }, reason: "Create a pending candidate.", confirmed: true,
    });
    expect(candidate.response.status).toBe(200);
    const candidateValue = candidate.body.value as { candidates: { id: string }[]; entityVersion: number };
    const before = await (await fetch(`${server.origin}/api/project/brief`)).json() as { value: { active: { currentTask: string }; candidates: { status: string }[] } };
    expect(before.value.active.currentTask).toContain("Verify the typed");
    expect(before.value.candidates[0]?.status).toBe("pending");

    const activated = await command(server.origin, token, "/api/commands/brief/activate", {
      commandType: "activate_brief_candidate", projectId: state.project.id, proposalId: candidateValue.candidates[0]?.id,
      expectedVersion: candidateValue.entityVersion, reason: "I reviewed the field-level diff.", confirmed: true,
    });
    expect(activated.response.status).toBe(200);
    expect(activated.body).toMatchObject({ ok: true, value: { schemaVersion: "1.0.0", workspace: { active: { currentTask: "Activate only after a second explicit command." } } } });
    expect(await readFile(join(state.root, ".sestina", "research-brief.yaml"), "utf8")).toContain("Activate only after a second explicit command.");
  });
});
