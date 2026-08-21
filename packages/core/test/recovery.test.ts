import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaintenanceGuard } from "@sestina/storage";
import {
  createProjectStateBackup,
  inspectProjectRecovery,
  openSestina,
  previewProjectStateRestore,
  restoreProjectState,
  type CoreResult,
  type SestinaCore,
} from "../src/index.js";

const roots: string[] = [];
const cores: SestinaCore[] = [];
const USER = { kind: "user", actorId: "ri41-test" } as const;

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function digest(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }

async function directorySnapshot(root: string): Promise<Record<string, { bytes: string; mtimeMs: number }>> {
  const result: Record<string, { bytes: string; mtimeMs: number }> = {};
  async function visit(directory: string, prefix = ""): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) result[relative] = { bytes: (await readFile(path)).toString("base64"), mtimeMs: (await stat(path)).mtimeMs };
    }
  }
  await visit(root); return result;
}

async function fixture(): Promise<{ root: string; projectId: string; briefId: string; briefVersionId: string; yaml: string }> {
  const root = await mkdtemp(join(tmpdir(), "sestina-ri41-"));
  roots.push(root);
  await mkdir(join(root, ".sestina"), { recursive: true });
  const opened = await openSestina({ databasePath: join(root, ".sestina", "state.sqlite") });
  const core = valueOf(opened);
  cores.push(core);
  const project = valueOf(core.initializeProject({ title: "Private offline study", actor: USER }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id,
    actor: USER,
    projectQuestion: "Can the current local research state be recovered exactly?",
    currentStage: "revision",
    currentTask: "Preserve the exact research boundary",
    targetArtifacts: [], fixedDecisions: [],
    allowedChanges: [{ target: { kind: "project_path", relativePath: "paper" }, operations: ["add", "delete", "rewrite"] }],
    forbiddenChanges: [],
    expectedDeltas: [{ statement: "Preserve the exact research boundary", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] } }],
    evidenceBoundaries: [], explicitNonGoals: ["Upload research content"],
  }));
  const projection = valueOf(core.getActiveBriefProjection(project.id));
  if (projection === undefined) throw new Error("fixture brief missing");
  await writeFile(join(root, ".sestina", "research-brief.yaml"), projection.yaml, "utf8");
  return { root, projectId: project.id, briefId: brief.id, briefVersionId: projection.versionId, yaml: projection.yaml };
}

afterEach(async () => {
  for (const core of cores.splice(0)) core.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RI-41 complete local recovery bundles", () => {
  it("creates a strict, self-verifying DB + Research Brief bundle with no paths or content in output", async () => {
    const source = await fixture();
    const result = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    expect(result).toMatchObject({ kind: "manual", projectId: source.projectId, integrity: "ok", briefBinding: "matched", networkUsed: false });
    expect(result.backupId).toMatch(/^bkp_\d{8}T\d{9}Z_[0-9a-f]{12}$/);
    expect(JSON.stringify(result)).not.toContain(source.root);
    expect(JSON.stringify(result)).not.toContain(source.yaml);

    const directory = join(source.root, ".sestina", "backups", "manual", result.backupId);
    expect((await readdir(directory)).sort()).toEqual([
      "manifest.json", "research-brief.yaml", "research-brief.yaml.sha256", "state.sqlite", "state.sqlite.sha256",
    ]);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(manifest).sort()).toEqual([
      "activeBriefId", "activeBriefVersionId", "backupId", "bindingHash", "brief", "createdAt", "database", "databaseSchemaVersion", "kind", "projectId", "runtimeVersion", "schemaVersion",
    ].sort());
    expect(manifest).toMatchObject({ schemaVersion: "1.0.0", backupId: result.backupId, kind: "manual", projectId: source.projectId, activeBriefId: source.briefId, activeBriefVersionId: source.briefVersionId });
  });

  it("includes committed WAL state and reports only verified managed backups", async () => {
    const source = await fixture();
    const core = cores[0]; if (core === undefined) throw new Error("fixture core missing");
    valueOf(core.recordDecision({
      projectId: source.projectId, actor: USER, statement: "WAL canary decision", rationale: "Must survive a SQLite online backup",
      scope: { kind: "project" }, effectiveBriefVersionId: source.briefVersionId, reopenConditions: [], status: "frozen",
    }));
    const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    const status = valueOf(await inspectProjectRecovery({ projectRoot: source.root }));
    expect(status).toMatchObject({ currentState: "healthy", restoreAvailable: true, networkUsed: false });
    expect(status.backups).toHaveLength(1);
    const summary = status.backups[0];
    expect(summary).toMatchObject({ backupId: created.backupId, valid: true, kind: "manual", verification: "verified" });
    expect(typeof summary?.databaseSchemaVersion).toBe("number"); expect(typeof summary?.databaseSizeBytes).toBe("number"); expect(typeof summary?.briefSizeBytes).toBe("number");

    const copied = await mkdtemp(join(tmpdir(), "sestina-ri41-copy-")); roots.push(copied);
    const backupDb = join(source.root, ".sestina", "backups", "manual", created.backupId, "state.sqlite");
    const opened = valueOf(await openSestina({ databasePath: backupDb, readOnly: true, immutable: true })); cores.push(opened);
    expect(valueOf(opened.listDecisions(source.projectId))).toEqual(expect.arrayContaining([expect.objectContaining({ statement: "WAL canary decision" })]));
  });

  it("fails closed and leaves no partial directory when bundle publication fails", async () => {
    const source = await fixture();
    const result = await createProjectStateBackup({
      projectRoot: source.root,
      faultInjection: { beforePublish: () => { throw new Error("injected"); } },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "infrastructure_failure" } });
    const manual = join(source.root, ".sestina", "backups", "manual");
    expect(await readdir(manual).catch(() => [])).toEqual([]);
  });

  it("detects Brief drift and tampered or malformed bundles without exposing their contents", async () => {
    const source = await fixture();
    const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    await writeFile(join(source.root, ".sestina", "research-brief.yaml"), `${source.yaml}# drift\n`, "utf8");
    expect(valueOf(await inspectProjectRecovery({ projectRoot: source.root }))).toMatchObject({ currentState: "recovery_required", currentBriefBinding: "mismatched" });
    expect(await createProjectStateBackup({ projectRoot: source.root })).toMatchObject({ ok: false, error: { code: "state_conflict" } });

    const directory = join(source.root, ".sestina", "backups", "manual", created.backupId);
    await writeFile(join(directory, "research-brief.yaml"), "tampered\n", "utf8");
    const preview = await previewProjectStateRestore({ projectRoot: source.root, backupId: created.backupId });
    expect(preview).toMatchObject({ ok: false, error: { code: "state_conflict" } });
    expect(JSON.stringify(preview)).not.toContain("tampered");
    expect(valueOf(await inspectProjectRecovery({ projectRoot: source.root }))).toMatchObject({
      restoreAvailable: false, backups: [expect.objectContaining({ backupId: created.backupId, valid: false, verification: "failed" })],
    });
  });

  it("rejects every strict manifest/hash/binding/integrity tamper class", async () => {
    const source = await fixture(); const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    const directory = join(source.root, ".sestina", "backups", "manual", created.backupId);
    const manifestPath = join(directory, "manifest.json"); const databasePath = join(directory, "state.sqlite"); const briefPath = join(directory, "research-brief.yaml");
    const originalManifestText = await readFile(manifestPath, "utf8"); const originalDatabase = await readFile(databasePath); const originalBrief = await readFile(briefPath);
    const originalDatabaseSidecar = await readFile(`${databasePath}.sha256`, "utf8"); const originalBriefSidecar = await readFile(`${briefPath}.sha256`, "utf8");
    const reset = async () => {
      await writeFile(manifestPath, originalManifestText); await writeFile(databasePath, originalDatabase); await writeFile(briefPath, originalBrief);
      await writeFile(`${databasePath}.sha256`, originalDatabaseSidecar); await writeFile(`${briefPath}.sha256`, originalBriefSidecar);
    };
    const rejected = async () => {
      expect(await previewProjectStateRestore({ projectRoot: source.root, backupId: created.backupId })).toMatchObject({ ok: false, error: { code: "state_conflict" } });
    };
    const originalManifest = JSON.parse(originalManifestText) as Record<string, unknown>;

    const missing = { ...originalManifest }; delete missing.runtimeVersion; await writeFile(manifestPath, JSON.stringify(missing)); await rejected(); await reset();
    await writeFile(manifestPath, JSON.stringify({ ...originalManifest, unexpected: true })); await rejected(); await reset();
    await writeFile(manifestPath, JSON.stringify({ ...originalManifest, schemaVersion: "2.0.0" })); await rejected(); await reset();
    await writeFile(manifestPath, JSON.stringify({ ...originalManifest, databaseSchemaVersion: 999 })); await rejected(); await reset();
    await writeFile(databasePath, Buffer.concat([originalDatabase, Buffer.from("database tamper")])); await rejected(); await reset();
    await writeFile(briefPath, Buffer.concat([originalBrief, Buffer.from("brief tamper")])); await rejected(); await reset();
    await writeFile(manifestPath, JSON.stringify({ ...originalManifest, bindingHash: "0".repeat(64) })); await rejected(); await reset();

    const corruptDatabase = Buffer.from("not a SQLite database"); const database = { sha256: digest(corruptDatabase), sizeBytes: corruptDatabase.byteLength };
    const brief = originalManifest.brief as { sha256: string; sizeBytes: number };
    const corruptManifest = { ...originalManifest, database } as Record<string, unknown>;
    corruptManifest.bindingHash = digest(JSON.stringify({
      projectId: corruptManifest.projectId, activeBriefId: corruptManifest.activeBriefId, activeBriefVersionId: corruptManifest.activeBriefVersionId,
      databaseSha256: database.sha256, briefSha256: brief.sha256,
    }));
    await writeFile(databasePath, corruptDatabase); await writeFile(`${databasePath}.sha256`, `${database.sha256}\n`); await writeFile(manifestPath, JSON.stringify(corruptManifest));
    await rejected();
  });

  it("rejects traversal, unknown IDs, and linked backup directories", async () => {
    const source = await fixture();
    expect(await previewProjectStateRestore({ projectRoot: source.root, backupId: "../../outside" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await previewProjectStateRestore({ projectRoot: source.root, backupId: "bkp_20260821T010203004Z_aaaaaaaaaaaa" })).toMatchObject({ ok: false, error: { code: "not_found" } });

    const outside = await mkdtemp(join(tmpdir(), "sestina-ri41-outside-")); roots.push(outside);
    const manual = join(source.root, ".sestina", "backups", "manual"); await mkdir(manual, { recursive: true });
    const linkedId = "bkp_20260821T010203004Z_bbbbbbbbbbbb";
    await symlink(outside, join(manual, linkedId), process.platform === "win32" ? "junction" : "dir");
    expect(await previewProjectStateRestore({ projectRoot: source.root, backupId: linkedId })).toMatchObject({ ok: false, error: { code: "invalid_input" } });

    const parentEscape = await fixture(); const parentOutside = await mkdtemp(join(tmpdir(), "sestina-ri41-parent-outside-")); roots.push(parentOutside);
    await symlink(parentOutside, join(parentEscape.root, ".sestina", "backups"), process.platform === "win32" ? "junction" : "dir");
    expect(await createProjectStateBackup({ projectRoot: parentEscape.root })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await inspectProjectRecovery({ projectRoot: parentEscape.root })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("previews without mutation, restores atomically, and creates a complete pre-restore bundle", async () => {
    const source = await fixture();
    const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    const databasePath = join(source.root, ".sestina", "state.sqlite");
    const briefPath = join(source.root, ".sestina", "research-brief.yaml");
    const beforeDb = await readFile(databasePath); const beforeBrief = await readFile(briefPath);
    const preview = valueOf(await previewProjectStateRestore({ projectRoot: source.root, backupId: created.backupId }));
    expect(preview).toMatchObject({ backupId: created.backupId, confirmationRequired: true, databaseIntegrity: "ok", briefBinding: "matched", networkUsed: false });
    expect(await readFile(databasePath)).toEqual(beforeDb); expect(await readFile(briefPath)).toEqual(beforeBrief);

    const liveCore = cores[0]; if (liveCore === undefined) throw new Error("fixture core missing");
    const current = valueOf(liveCore.getBriefState(source.projectId));
    if (current === undefined) throw new Error("active brief missing");
    const edited = valueOf(liveCore.editBrief({
      projectId: source.projectId, actor: USER, expectedVersion: current.brief.version,
      projectQuestion: "Can the current local research state be recovered exactly?", currentStage: "revision",
      currentTask: "A later but still internally bound research task", targetArtifacts: [], fixedDecisions: [],
      allowedChanges: [{ target: { kind: "project_path", relativePath: "paper" }, operations: ["add", "delete", "rewrite"] }],
      forbiddenChanges: [], expectedDeltas: [{ statement: "Preserve the exact research boundary", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] } }],
      evidenceBoundaries: [], explicitNonGoals: ["Upload research content"],
    }));
    const laterProjection = valueOf(liveCore.getActiveBriefProjection(source.projectId));
    if (laterProjection?.versionId !== edited.version.id) throw new Error("edited brief missing");
    await writeFile(briefPath, laterProjection.yaml, "utf8");
    for (const core of cores.splice(0)) core.close();
    const restored = valueOf(await restoreProjectState({ projectRoot: source.root, backupId: created.backupId, confirmed: true }));
    expect(restored).toMatchObject({ restored: true, backupId: created.backupId, databaseIntegrity: "ok", briefBinding: "matched", forensicCopyPreserved: false, networkUsed: false });
    expect(restored.preRestoreBackupId).toMatch(/^pre_/);
    expect(await readFile(briefPath, "utf8")).toBe(source.yaml);
    const preDirectory = join(source.root, ".sestina", "backups", "manual", restored.preRestoreBackupId);
    expect((await readdir(preDirectory)).sort()).toEqual([
      "manifest.json", "research-brief.yaml", "research-brief.yaml.sha256", "state.sqlite", "state.sqlite.sha256",
    ]);
  });

  it("requires confirmation, preserves corrupt current files forensically, then restores", async () => {
    const source = await fixture();
    const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    const databasePath = join(source.root, ".sestina", "state.sqlite");
    for (const core of cores.splice(0)) core.close();
    await writeFile(databasePath, "not sqlite", "utf8");
    await writeFile(`${databasePath}-wal`, "forensic wal", "utf8"); await writeFile(`${databasePath}-shm`, "forensic shm", "utf8");
    expect(await restoreProjectState({ projectRoot: source.root, backupId: created.backupId, confirmed: false })).toMatchObject({ ok: false, error: { code: "user_confirmation_required" } });
    const restored = valueOf(await restoreProjectState({ projectRoot: source.root, backupId: created.backupId, confirmed: true }));
    expect(restored).toMatchObject({ restored: true, forensicCopyPreserved: true, databaseIntegrity: "ok", briefBinding: "matched" });
    expect(restored.preRestoreBackupId).toMatch(/^forensic_/);
    const forensic = join(source.root, ".sestina", "backups", "forensic", restored.preRestoreBackupId);
    expect(await readFile(join(forensic, "state.sqlite"), "utf8")).toBe("not sqlite");
    expect(await readFile(join(forensic, "state.sqlite-wal"), "utf8")).toBe("forensic wal");
    expect(await readFile(join(forensic, "state.sqlite-shm"), "utf8")).toBe("forensic shm");
    await expect(stat(`${databasePath}-wal`)).rejects.toBeDefined(); await expect(stat(`${databasePath}-shm`)).rejects.toBeDefined();
  });

  it("rolls both live files back if the second commit fails", async () => {
    const source = await fixture();
    const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    const databasePath = join(source.root, ".sestina", "state.sqlite"); const briefPath = join(source.root, ".sestina", "research-brief.yaml");
    const beforeDb = await readFile(databasePath); const beforeBrief = Buffer.from(`${source.yaml}# current\n`); await writeFile(briefPath, beforeBrief);
    const restored = await restoreProjectState({
      projectRoot: source.root, backupId: created.backupId, confirmed: true,
      faultInjection: { beforeBriefCommit: () => { throw new Error("second-file failure"); } },
    });
    expect(restored).toMatchObject({ ok: false, error: { code: "infrastructure_failure" } });
    expect(await readFile(databasePath)).toEqual(beforeDb); expect(await readFile(briefPath)).toEqual(beforeBrief);
  });

  it("rejects a source bundle swapped after validation and honors maintenance contention", async () => {
    const source = await fixture();
    const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    const manifestPath = join(source.root, ".sestina", "backups", "manual", created.backupId, "manifest.json");
    const swap = await restoreProjectState({
      projectRoot: source.root, backupId: created.backupId, confirmed: true,
      faultInjection: { afterSourceValidation: async () => writeFile(manifestPath, "{}\n", "utf8") },
    });
    expect(swap).toMatchObject({ ok: false, error: { code: "state_conflict" } });

    const second = await fixture();
    const backup = valueOf(await createProjectStateBackup({ projectRoot: second.root }));
    const guard = await MaintenanceGuard.acquire({ databasePath: join(second.root, ".sestina", "state.sqlite"), ownerId: "other", scope: "test", busyTimeoutMs: 1 });
    try {
      expect(await restoreProjectState({ projectRoot: second.root, backupId: backup.backupId, confirmed: true, maintenanceBusyTimeoutMs: 1 })).toMatchObject({ ok: false, error: { code: "infrastructure_failure" } });
    } finally { guard.release(); }
  });

  it("reports rollback infrastructure failure and retains rollback materials instead of claiming success", async () => {
    const source = await fixture(); const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    for (const core of cores.splice(0)) core.close();
    const result = await restoreProjectState({
      projectRoot: source.root, backupId: created.backupId, confirmed: true,
      faultInjection: {
        beforeBriefCommit: () => { throw new Error("commit failure"); },
        beforeRollback: () => { throw new Error("rollback failure"); },
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "infrastructure_failure" } });
    const retained = (await readdir(join(source.root, ".sestina"))).filter((name) => name.startsWith(".rollback-"));
    expect(retained.length).toBeGreaterThanOrEqual(2);
  });

  it("status is read-only even for a corrupt database and still lists verified recovery choices", async () => {
    const source = await fixture();
    const created = valueOf(await createProjectStateBackup({ projectRoot: source.root }));
    for (const core of cores.splice(0)) core.close();
    const databasePath = join(source.root, ".sestina", "state.sqlite");
    await writeFile(databasePath, "corrupt bytes", "utf8");
    const before = await readFile(databasePath); const beforeStat = await stat(databasePath);
    const snapshotBefore = await directorySnapshot(join(source.root, ".sestina"));
    const status = valueOf(await inspectProjectRecovery({ projectRoot: source.root }));
    const repeated = valueOf(await inspectProjectRecovery({ projectRoot: source.root }));
    expect(status).toMatchObject({ currentState: "recovery_required", databaseIntegrity: "failed", restoreAvailable: true, backups: [expect.objectContaining({ backupId: created.backupId, valid: true })] });
    expect(repeated).toEqual(status);
    expect(await readFile(databasePath)).toEqual(before); expect((await stat(databasePath)).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(await directorySnapshot(join(source.root, ".sestina"))).toEqual(snapshotBefore);
    expect(await lstat(databasePath).then((value) => value.isFile())).toBe(true);
  });
});
