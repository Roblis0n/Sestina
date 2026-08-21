import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..");
const cli = join(repositoryRoot, "apps", "cli", "dist", "main.js");

function command(project: string, args: readonly string[], allowed = [0]): { code: number; value: Record<string, unknown>; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args, "--project", project, "--json"], { cwd: project, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 30_000 });
  const text = `${result.stdout}\n${result.stderr}`.split(/\r?\n/u).find((line) => line.trim().startsWith("{"));
  if (text === undefined) throw new Error("CLI JSON result missing");
  const value = JSON.parse(text) as Record<string, unknown>;
  expect(allowed).toContain(result.status ?? -1);
  return { code: result.status ?? -1, value, stdout: result.stdout, stderr: result.stderr };
}

function briefYaml(projectId: string, task: string): string {
  return [
    `projectId: ${JSON.stringify(projectId)}`,
    `projectQuestion: ${JSON.stringify("Can exact local recovery preserve the accepted research boundary?")}`,
    "currentStage: revision", `currentTask: ${JSON.stringify(task)}`,
    "targetArtifacts: []", "fixedDecisions: []",
    `allowedChanges: ${JSON.stringify([{ target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] }])}`,
    "forbiddenChanges: []",
    `expectedDeltas: ${JSON.stringify([{ statement: "Prove exact recovery", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] } }])}`,
    "evidenceBoundaries: []", `explicitNonGoals: ${JSON.stringify(["Upload unpublished research"])}`, "",
  ].join("\n");
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
  }
  return files;
}

async function byteSnapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of await walk(directory)) result[path.slice(directory.length + 1).replaceAll("\\", "/")] = createHash("sha256").update(await readFile(path)).digest("hex");
  return result;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("RI-41 built CLI local recovery E2E", () => {
  it("round-trips both SQLite and the Research Brief, then recovers a corrupt live database forensically", async () => {
    const project = await mkdtemp(join(tmpdir(), "sestina-ri41-e2e-")); roots.push(project);
    const initialized = command(project, ["init", "--title", "Private recovery E2E", "--yes"]);
    const projectId = String(initialized.value.projectId);
    const initialTask = "RI41_E2E_PRIVATE_INITIAL_TASK"; const laterTask = "RI41_E2E_PRIVATE_LATER_TASK";
    const briefPath = join(project, ".sestina", "research-brief.yaml"); const databasePath = join(project, ".sestina", "state.sqlite");
    const initialBrief = briefYaml(projectId, initialTask); await writeFile(briefPath, initialBrief, "utf8");
    expect(command(project, ["brief", "edit", "--from", ".sestina/research-brief.yaml", "--yes"]).code).toBe(0);
    const boundInitialBrief = await readFile(briefPath, "utf8");

    const backup = command(project, ["data", "backup"]); const backupId = String(backup.value.backupId);
    expect(backup.value).toMatchObject({ ok: true, command: "data backup", integrity: "ok", briefBinding: "matched", networkUsed: false });
    expect(`${backup.stdout}${backup.stderr}`).not.toContain(project); expect(`${backup.stdout}${backup.stderr}`).not.toContain(initialTask);
    expect(command(project, ["decision", "add", "--statement", "Post-backup decision", "--rationale", "Must disappear after restore", "--scope", "project"]).code).toBe(0);
    const laterBrief = briefYaml(projectId, laterTask); await writeFile(briefPath, laterBrief, "utf8");
    expect(command(project, ["brief", "edit", "--from", ".sestina/research-brief.yaml", "--yes"]).code).toBe(0);

    const beforePreviewDb = await readFile(databasePath); const beforePreviewBrief = await readFile(briefPath); const beforePreviewMtime = (await stat(databasePath)).mtimeMs;
    const preview = command(project, ["data", "restore", backupId], [7]);
    expect(preview.value).toMatchObject({ ok: false, command: "data restore", confirmationRequired: true, exitCode: 7 });
    expect(await readFile(databasePath)).toEqual(beforePreviewDb); expect(await readFile(briefPath)).toEqual(beforePreviewBrief); expect((await stat(databasePath)).mtimeMs).toBe(beforePreviewMtime);

    const restored = command(project, ["data", "restore", backupId, "--yes"]);
    expect(restored.value).toMatchObject({ ok: true, restored: true, backupId, databaseIntegrity: "ok", briefBinding: "matched", forensicCopyPreserved: false, networkUsed: false });
    expect(await readFile(briefPath, "utf8")).toBe(boundInitialBrief);
    const decisions = command(project, ["decision", "list"]); expect(decisions.value.decisions).toEqual([]);

    await writeFile(databasePath, "RI41_CORRUPT_DATABASE_CANARY", "utf8");
    const corruptStatus = command(project, ["data", "status"]);
    expect(corruptStatus.value).toMatchObject({ currentState: "recovery_required", databaseIntegrity: "failed", restoreAvailable: true });
    const corruptRestored = command(project, ["data", "restore", backupId, "--yes"]);
    expect(corruptRestored.value).toMatchObject({ restored: true, forensicCopyPreserved: true, databaseIntegrity: "ok", briefBinding: "matched" });
    expect(String(corruptRestored.value.preRestoreBackupId)).toMatch(/^forensic_/);
    expect(command(project, ["data", "status"]).value).toMatchObject({ currentState: "healthy", databaseIntegrity: "ok" });

    const stateBeforeDisconnect = await byteSnapshot(join(project, ".sestina"));
    expect(command(project, ["connect", "--host", "codex", "--yes"]).value).toMatchObject({ state: "configured" });
    expect(command(project, ["connection-status", "--host", "codex"]).value).toMatchObject({ state: "configured", hostVerification: "unverified" });
    expect(command(project, ["disconnect", "--host", "codex", "--yes"]).value).toMatchObject({ state: "not_connected" });
    const stateAfterDisconnect = await byteSnapshot(join(project, ".sestina"));
    for (const [path, hash] of Object.entries(stateBeforeDisconnect)) {
      if (path === ".sestina-maintenance.sqlite") continue;
      expect(stateAfterDisconnect[path], path).toBe(hash);
    }

    const suspicious = (await walk(project)).filter((path) => /\.(?:log|dmp|crash)$/i.test(path) || /crash[-_]?report/i.test(path));
    expect(suspicious).toEqual([]);
  });
});
