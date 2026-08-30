import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectStateBackup, openSestina, RandomIdFactory, SestinaCore, SystemClock, type CoreResult } from "@sestina/core";
import { MIGRATIONS, openDatabase, readSchemaVersion } from "@sestina/storage";
import { createResearchRoomServer, type RunningResearchRoomServer } from "../src/server.js";
import type {
  ExecutedProjectStateRestoreDto,
  PreparedProjectStateRestoreDto,
  ProjectRecoveryStatusDto,
  ProjectStateBackupDto,
} from "../client/src/api/dto.js";

const USER = Object.freeze({ kind: "user" as const, actorId: "ri53-api-owner" });
const roots: string[] = [];
const servers: RunningResearchRoomServer[] = [];

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

class LanguageStore {
  readLanguage() { return Promise.resolve("en" as const); }
  writeLanguage() { return Promise.resolve(); }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri53-api-")); roots.push(root);
  await mkdir(join(root, ".sestina"));
  const core = valueOf(await openSestina({ databasePath: join(root, ".sestina", "state.sqlite") }));
  const project = valueOf(core.initializeProject({ title: "RI-53 Recovery Lab", actor: USER }));
  valueOf(core.activateBrief({
    projectId: project.id, actor: USER, projectQuestion: "Can an exact local release restore the selected project safely?", currentStage: "revision", currentTask: "Verify the bound backup and explicit restore.",
    targetArtifacts: [], fixedDecisions: [], allowedChanges: [{ target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] }], forbiddenChanges: [],
    expectedDeltas: [{ statement: "Record a verifiable recovery result.", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] } }], evidenceBoundaries: [], explicitNonGoals: ["Use network access", "Restore without confirmation"],
  }));
  const projection = valueOf(core.getActiveBriefProjection(project.id));
  if (projection === undefined) throw new Error("RI-53 projection missing");
  await writeFile(join(root, ".sestina", "research-brief.yaml"), projection.yaml, "utf8");
  core.close();
  return { root, projectId: project.id, yaml: projection.yaml };
}

async function fixtureAtSchema16() {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri53-upgrade-")); roots.push(root);
  await mkdir(join(root, ".sestina"));
  const database = await openDatabase({ path: join(root, ".sestina", "state.sqlite"), migrate: { migrations: MIGRATIONS.slice(0, 16) } });
  const core = new SestinaCore(database, new SystemClock(), new RandomIdFactory());
  const project = valueOf(core.initializeProject({ title: "RI-53 Schema 16 Upgrade", actor: USER }));
  valueOf(core.activateBrief({
    projectId: project.id, actor: USER, projectQuestion: "Can schema 16 upgrade without losing canonical state?", currentStage: "revision", currentTask: "Preserve project and Brief continuity through schema 20.",
    targetArtifacts: [], fixedDecisions: [], allowedChanges: [{ target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] }], forbiddenChanges: [],
    expectedDeltas: [{ statement: "Verify migration continuity.", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] } }], evidenceBoundaries: [], explicitNonGoals: ["Downgrade", "Automatic retry"],
  }));
  const projection = valueOf(core.getActiveBriefProjection(project.id)); if (projection === undefined) throw new Error("schema 16 projection missing");
  await writeFile(join(root, ".sestina", "research-brief.yaml"), projection.yaml, "utf8");
  core.close();
  return { root, projectId: project.id, yaml: projection.yaml };
}

async function start() {
  const running = await createResearchRoomServer({ languagePreferenceStore: new LanguageStore() }).start();
  servers.push(running);
  const status = await (await fetch(`${running.origin}/api/status`)).json() as { readonly value: { readonly sessionToken: string } };
  return { running, token: status.value.sessionToken };
}

interface ApiBody<T> {
  readonly ok: boolean;
  readonly value: T;
  readonly error?: { readonly code: string };
}

async function api<T = unknown>(origin: string, token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, { method, headers: { "x-sestina-session": token, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json() as ApiBody<T> };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RI-53 production recovery API", () => {
  it("creates, lists, previews, binds, restores, reopens, and rejects replay or drift", async () => {
    const project = await fixture();
    const { running, token } = await start();
    expect((await api(running.origin, token, "POST", "/api/project/open", { projectPath: project.root, initializeIfNeeded: false })).body).toMatchObject({ ok: true, value: { recoveryRequired: false } });
    const backup = await api<ProjectStateBackupDto>(running.origin, token, "POST", "/api/project/recovery/backup", {});
    expect(backup.response.status).toBe(201);
    expect(backup.body).toMatchObject({ ok: true, value: { kind: "manual", integrity: "ok", briefBinding: "matched", networkUsed: false } });
    const backupId = backup.body.value.backupId;
    const status = await api<ProjectRecoveryStatusDto>(running.origin, token, "GET", "/api/project/recovery");
    expect(status.body).toMatchObject({ ok: true, value: { currentState: "healthy", restoreAvailable: true, backups: [expect.objectContaining({ backupId, verification: "verified", valid: true })], networkUsed: false } });

    const prepared = await api<PreparedProjectStateRestoreDto>(running.origin, token, "POST", "/api/project/recovery/restore/preview", { backupId });
    expect(prepared.body).toMatchObject({ ok: true, value: { backupId, confirmationRequired: true, compatibility: "supported", currentState: { currentState: "healthy" }, networkUsed: false } });
    expect(prepared.body.value.confirmationNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.body.value.stateBinding).toMatch(/^[0-9a-f]{64}$/);
    const restored = await api<ExecutedProjectStateRestoreDto>(running.origin, token, "POST", "/api/project/recovery/restore", { backupId, confirmationNonce: prepared.body.value.confirmationNonce, expectedStateBinding: prepared.body.value.stateBinding, confirmed: true });
    expect(restored.body).toMatchObject({ ok: true, value: { restored: true, confirmationConsumed: true, reopened: true, rollback: { performed: false, currentStatePreserved: true }, project: { id: project.projectId }, networkUsed: false } });
    expect((await api(running.origin, token, "POST", "/api/project/recovery/restore", { backupId, confirmationNonce: prepared.body.value.confirmationNonce, expectedStateBinding: prepared.body.value.stateBinding, confirmed: true })).body).toMatchObject({ ok: false, error: { code: "confirmation_replayed" } });

    const driftPreview = await api<PreparedProjectStateRestoreDto>(running.origin, token, "POST", "/api/project/recovery/restore/preview", { backupId });
    await writeFile(join(project.root, ".sestina", "research-brief.yaml"), `${project.yaml}# drift\n`, "utf8");
    expect((await api(running.origin, token, "POST", "/api/project/recovery/restore", { backupId, confirmationNonce: driftPreview.body.value.confirmationNonce, expectedStateBinding: driftPreview.body.value.stateBinding, confirmed: true })).body).toMatchObject({ ok: false, error: { code: "confirmation_binding_mismatch" } });
  });

  it("offers a fail-closed recovery target when startup finds corrupt state, then restores the managed bundle", async () => {
    const project = await fixture();
    const created = valueOf(await createProjectStateBackup({ projectRoot: project.root }));
    const databasePath = join(project.root, ".sestina", "state.sqlite");
    await writeFile(databasePath, "corrupt current database", "utf8");
    const { running, token } = await start();
    const opened = await api(running.origin, token, "POST", "/api/project/open", { projectPath: project.root, initializeIfNeeded: false });
    expect(opened.body).toMatchObject({ ok: true, value: { recoveryRequired: true, setupRequired: false } });
    expect((await api(running.origin, token, "GET", "/api/project/recovery")).body).toMatchObject({ ok: true, value: { currentState: "recovery_required", databaseIntegrity: "failed", restoreAvailable: true } });
    const prepared = await api<PreparedProjectStateRestoreDto>(running.origin, token, "POST", "/api/project/recovery/restore/preview", { backupId: created.backupId });
    const restored = await api<ExecutedProjectStateRestoreDto>(running.origin, token, "POST", "/api/project/recovery/restore", { backupId: created.backupId, confirmationNonce: prepared.body.value.confirmationNonce, expectedStateBinding: prepared.body.value.stateBinding, confirmed: true });
    expect(restored.body).toMatchObject({ ok: true, value: { restored: true, reopened: true, forensicCopyPreserved: true } });
    expect((await readFile(databasePath)).subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
    expect((await api(running.origin, token, "GET", "/api/project/recovery")).body).toMatchObject({ ok: true, value: { currentState: "healthy", databaseIntegrity: "ok", currentBriefBinding: "matched" } });
  });

  it("requires the active loopback session before any recovery mutation", async () => {
    const project = await fixture(); const { running, token } = await start();
    await api(running.origin, token, "POST", "/api/project/open", { projectPath: project.root, initializeIfNeeded: false });
    const denied = await api(running.origin, "wrong-session-token", "POST", "/api/project/recovery/backup", {});
    expect(denied.response.status).toBe(403);
    expect(denied.body).toMatchObject({ ok: false, error: { code: "explicit_action_required" } });
  });

  it("creates a complete verified pre-upgrade bundle, migrates schema 16 to 20, and preserves restart continuity", async () => {
    const project = await fixtureAtSchema16(); const { running, token } = await start();
    const opened = await api(running.origin, token, "POST", "/api/project/open", { projectPath: project.root, initializeIfNeeded: false });
    expect(opened.body).toMatchObject({ ok: true, value: { recoveryRequired: false, project: { id: project.projectId } } });
    const status = await api<ProjectRecoveryStatusDto>(running.origin, token, "GET", "/api/project/recovery");
    expect(status.body).toMatchObject({ ok: true, value: { currentState: "healthy", schema: { status: "recognized", version: 20, supportedMinimum: 16, supportedVersion: 20 }, backups: [expect.objectContaining({ kind: "pre_upgrade", databaseSchemaVersion: 16, verification: "verified", valid: true })] } });
    const database = await openDatabase({ path: join(project.root, ".sestina", "state.sqlite"), readOnly: true });
    expect(readSchemaVersion(database)).toBe(20); database.close();
    expect((await api(running.origin, token, "GET", "/api/state")).body).toMatchObject({ ok: true, value: { project: { id: project.projectId }, brief: { currentTask: "Preserve project and Brief continuity through schema 20." } } });

    await running.close(); servers.splice(servers.indexOf(running), 1);
    const restarted = await start();
    expect((await api(restarted.running.origin, restarted.token, "POST", "/api/project/open", { projectPath: project.root, initializeIfNeeded: false })).body).toMatchObject({ ok: true, value: { recoveryRequired: false, project: { id: project.projectId } } });
    const restartedStatus = await api<ProjectRecoveryStatusDto>(restarted.running.origin, restarted.token, "GET", "/api/project/recovery");
    expect(restartedStatus.body.value.backups.filter((backup: { readonly kind: string }) => backup.kind === "pre_upgrade")).toHaveLength(1);
  });

  it("records a failed migration without auto-retry and keeps the exact verified pre-upgrade bundle", async () => {
    const project = await fixtureAtSchema16();
    const databasePath = join(project.root, ".sestina", "state.sqlite");
    const sabotaged = await openDatabase({ path: databasePath, migrate: false });
    sabotaged.exec("CREATE TABLE correction_appeals (appeal_id TEXT PRIMARY KEY) STRICT"); sabotaged.close();
    const { running, token } = await start();
    const opened = await api(running.origin, token, "POST", "/api/project/open", { projectPath: project.root, initializeIfNeeded: false });
    expect(opened.body).toMatchObject({ ok: true, value: { recoveryRequired: true } });
    const status = await api(running.origin, token, "GET", "/api/project/recovery");
    expect(status.body).toMatchObject({ ok: true, value: { currentState: "recovery_required", schema: { status: "migration_failed", version: 16, failedVersion: 17 }, restoreAvailable: true, backups: [expect.objectContaining({ kind: "pre_upgrade", databaseSchemaVersion: 16, valid: true })] } });
    const inspected = await openDatabase({ path: databasePath, readOnly: true });
    expect(readSchemaVersion(inspected)).toBe(16);
    expect(inspected.get<{ readonly title: string }>("SELECT title FROM research_projects WHERE project_id = ?", project.projectId)?.title).toBe("RI-53 Schema 16 Upgrade");
    expect(inspected.get<{ readonly status: string }>("SELECT status FROM migrations WHERE version = 17")?.status).toBe("failed");
    inspected.close();
    const repeated = await api(running.origin, token, "GET", "/api/project/recovery");
    expect(repeated.body).toMatchObject({ ok: true, value: { schema: { status: "migration_failed", failedVersion: 17 } } });
  });

  it("refuses a future schema before writable open and leaves its database bytes unchanged", async () => {
    const project = await fixture(); const databasePath = join(project.root, ".sestina", "state.sqlite");
    const future = await openDatabase({ path: databasePath, migrate: false });
    future.run("INSERT INTO migrations (version, name, status, runtime_version, started_at, finished_at) VALUES (21, '021-future-fixture', 'completed', 'future-runtime', ?, ?)", Date.now(), Date.now());
    future.close();
    const before = await readFile(databasePath);
    const { running, token } = await start();
    expect((await api(running.origin, token, "POST", "/api/project/open", { projectPath: project.root, initializeIfNeeded: false })).body).toMatchObject({ ok: true, value: { recoveryRequired: true } });
    expect((await api(running.origin, token, "GET", "/api/project/recovery")).body).toMatchObject({ ok: true, value: { currentState: "recovery_required", schema: { status: "too_new", version: 21, supportedVersion: 20 }, restoreAvailable: false } });
    expect(await readFile(databasePath)).toEqual(before);
  });
});
