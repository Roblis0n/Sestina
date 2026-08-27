import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSestina, type CoreResult } from "@sestina/core";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../src/server.js";
import type { AppLanguage, LanguagePreferenceStore } from "../src/language-preferences.js";

const USER = Object.freeze({ kind: "user" as const, actorId: "ri51-api-owner" });
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

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri51-api-")); roots.push(root);
  const state = join(root, ".sestina"); await mkdir(state);
  const core = valueOf(await openSestina({ databasePath: join(state, "state.sqlite") }));
  const project = valueOf(core.initializeProject({ title: "RI-51 API project", actor: USER }));
  const artifact = valueOf(core.createArtifactWithInitialRevision({ projectId: project.id, actor: USER, kind: "research_note", relativePath: "notes/ri51-api.md", content: "RI-51 API continuity", mediaType: "text/markdown" }));
  valueOf(core.activateBrief({
    projectId: project.id, actor: USER,
    projectQuestion: "How can project memory stay explicit and local?", currentStage: "revision", currentTask: "Verify the strict RI-51 API.", targetArtifacts: [artifact.artifact.id],
    fixedDecisions: [{ statement: "No automatic memory.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "archives" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add governed continuity.", scope: { target: { kind: "artifact", artifactId: artifact.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "Memory is not fact.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Cross-project memory"],
  }));
  core.close();
  await writeFile(join(state, "research-brief.yaml"), "# RI-51 production fixture\n", "utf8");
  return { root, project };
}

async function openServer(root: string) {
  const server = await createResearchRoomServer({ languagePreferenceStore: new LanguageStore() }).start(); servers.push(server);
  const status = await (await fetch(`${server.origin}/api/status`)).json() as { value: { sessionToken: string } };
  const response = await fetch(`${server.origin}/api/project/open`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": status.value.sessionToken }, body: JSON.stringify({ projectPath: root }) });
  expect(response.status).toBe(200);
  return { server, token: status.value.sessionToken };
}

interface ApiEnvelope<T> { readonly ok: boolean; readonly value?: T; readonly error?: { readonly code: string } }

async function post<T = unknown>(origin: string, token: string, path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-sestina-session": token }, body: JSON.stringify(body) });
  return { response, body: await response.json() as ApiEnvelope<T> };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  while (roots.length > 0) { const root = roots.pop(); if (root) await rm(root, { recursive: true, force: true }); }
});

describe("RI-51 strict production API", () => {
  it("creates, confirms, projects, checkpoints, and restores project-bound memory", async () => {
    const state = await createProject();
    let running = await openServer(state.root);
    const candidate = await post<{ readonly id: string; readonly state: "candidate"; readonly version: number }>(running.server.origin, running.token, "/api/project/memory/candidates", {
      commandType: "create_project_memory_candidate", projectId: state.project.id, kind: "resume_note",
      content: { text: "Resume from the active Brief." }, retention: { policy: "until_unpinned" }, sensitivity: "project_private", outboundPolicy: "never_send", publicReason: "Explicit local note.", confirmed: true,
    });
    expect(candidate.response.status).toBe(200);
    expect(candidate.body.value).toMatchObject({ state: "candidate", version: 1 });
    const item = candidate.body.value;
    if (item === undefined) throw new Error("candidate response missing value");
    const confirmed = await post(running.server.origin, running.token, `/api/project/memory/${item.id}/confirm`, { commandType: "confirm_project_memory", projectId: state.project.id, expectedVersion: item.version, publicReason: "Reviewed candidate.", confirmed: true });
    expect(confirmed.body.value).toMatchObject({ state: "active", outboundPolicy: "never_send" });
    const checkpoint = await post(running.server.origin, running.token, "/api/project/memory/checkpoint", { commandType: "review_project_resume", projectId: state.project.id, publicReason: "Reviewed current recovery state.", confirmed: true });
    expect(checkpoint.body.value).toMatchObject({ authorityClass: "resume_checkpoint_non_authoritative" });

    await running.server.close(); servers.pop();
    running = await openServer(state.root);
    const projection = await fetch(`${running.server.origin}/api/project/memory?limit=50`);
    expect(projection.status).toBe(200);
    const restored = await projection.json() as { value: { resume: { changes: { projectChanged: boolean; authority: unknown[]; workingMemory: unknown[] } } } };
    expect(restored).toMatchObject({ ok: true, value: { projectState: { authorityClass: "kernel_authoritative_projection" }, workingMemory: { items: [{ id: item.id, state: "active" }] }, resume: { reviewed: true } } });
    expect(restored.value.resume.changes).toEqual({ projectChanged: false, authority: [], workingMemory: [], summaryAuthority: "system_derived_deterministic_non_authoritative" });
  });

  it("rejects unknown fields, cross-project commands, unconfirmed writes, and defaults Manifest output to zero", async () => {
    const state = await createProject(); const { server, token } = await openServer(state.root);
    const base = { commandType: "create_project_memory_candidate", projectId: state.project.id, kind: "working_hint", content: { text: "Bounded hint." }, retention: { policy: "until_unpinned" }, sensitivity: "project_private", outboundPolicy: "explicit_manifest_only", publicReason: "Explicit candidate." };
    const unconfirmed = await post(server.origin, token, "/api/project/memory/candidates", { ...base, confirmed: false });
    expect(unconfirmed.response.status).toBe(400); expect(unconfirmed.body).toMatchObject({ error: { code: "user_confirmation_required" } });
    const unknown = await post(server.origin, token, "/api/project/memory/candidates", { ...base, confirmed: true, rawPath: state.root });
    expect(unknown.response.status).toBe(400); expect(unknown.body).toMatchObject({ error: { code: "invalid_input" } });
    const crossProject = await post(server.origin, token, "/api/project/memory/candidates", { ...base, projectId: "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAV", confirmed: true });
    expect(crossProject.response.status).toBe(409); expect(crossProject.body).toMatchObject({ error: { code: "cross_project_reference" } });
    const zero = await post(server.origin, token, "/api/project/memory/manifests/prepare", { commandType: "prepare_project_memory_manifest", projectId: state.project.id, selectedItemIds: [], confirmed: true });
    expect(zero.response.status).toBe(200); expect(zero.body.value).toMatchObject({ included: [], providerPayload: { items: [] } });
    expect(JSON.stringify(zero.body)).not.toContain(state.root);
  });
});
