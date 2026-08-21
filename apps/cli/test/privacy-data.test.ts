import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSestina, type CoreResult } from "@sestina/core";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";

const roots: string[] = [];
const USER = { kind: "user", actorId: "cli-ri41-test" } as const;

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function capture(cwd: string): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = []; const stderr: string[] = [];
  return { stdout, stderr, io: { cwd, isTTY: false, stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) } };
}

async function command(cwd: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string; json?: Record<string, unknown> }> {
  const output = capture(cwd); const code = await runCli(args, output.io); const stdout = output.stdout.join(""); const stderr = output.stderr.join("");
  const jsonText = stdout.trim() || stderr.trim();
  return { code, stdout, stderr, ...(args.includes("--json") && jsonText.startsWith("{") ? { json: JSON.parse(jsonText) as Record<string, unknown> } : {}) };
}

async function initializedFixture(): Promise<{ root: string; projectId: string; originalBrief: string }> {
  const root = await mkdtemp(join(tmpdir(), "sestina-cli-ri41-")); roots.push(root);
  const initialized = await command(root, ["init", "--project", root, "--title", "RI-41 local study", "--yes", "--json"]);
  expect(initialized.code).toBe(0);
  const opened = valueOf(await openSestina({ databasePath: join(root, ".sestina", "state.sqlite") }));
  try {
    const projects = valueOf(opened.listProjects()); const project = projects[0]; if (project === undefined) throw new Error("project missing");
    valueOf(opened.activateBrief({
      projectId: project.id, actor: USER, projectQuestion: "Can recovery preserve the current research question?", currentStage: "revision",
      currentTask: "Verify local recovery", targetArtifacts: [], fixedDecisions: [],
      allowedChanges: [{ target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] }], forbiddenChanges: [],
      expectedDeltas: [{ statement: "Add recovery evidence", scope: { target: { kind: "project_path", relativePath: "paper" }, operations: ["rewrite"] } }],
      evidenceBoundaries: [], explicitNonGoals: ["Network transfer"],
    }));
    const projection = valueOf(opened.getActiveBriefProjection(project.id)); if (projection === undefined) throw new Error("brief missing");
    await writeFile(join(root, ".sestina", "research-brief.yaml"), projection.yaml, "utf8");
    return { root, projectId: project.id, originalBrief: projection.yaml };
  } finally { opened.close(); }
}

async function filesUnder(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path)); else result.push(path);
  }
  return result;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("RI-41 privacy and recovery CLI", () => {
  it("shows the canonical privacy manifest in stable JSON and plain human output", async () => {
    const root = await mkdtemp(join(tmpdir(), "sestina-privacy-")); roots.push(root);
    const json = await command(root, ["privacy", "show", "--project", root, "--json"]);
    expect(json).toMatchObject({ code: 0, json: { ok: true, command: "privacy show", scope: "project", schemaVersion: "1.0.0", networkDefault: "denied", automaticTelemetry: false, crashReports: false, backgroundContentLogging: false, automaticUpload: false, authorityMutationByExternalModel: false } });
    const dataFlows = json.json?.dataFlows as { readonly codexHost?: Record<string, unknown> } | undefined;
    expect(dataFlows?.codexHost).toMatchObject({ automatic: false, networkUsed: true, requiresExplicitUserAction: true, canMutateAuthority: false });
    expect(JSON.stringify(json.json)).not.toContain(root);
    const human = await command(root, ["privacy", "show"]);
    expect(human).toMatchObject({ code: 0, stderr: "" });
    expect(human.stdout).toContain("network denied by default"); expect(human.stdout).not.toContain(root);
  });

  it("backs up, reports, previews with confirmation exit, and restores without leaking paths or research text", async () => {
    const source = await initializedFixture();
    const backup = await command(source.root, ["data", "backup", "--project", source.root, "--json"]);
    expect(backup).toMatchObject({ code: 0, json: { ok: true, command: "data backup", kind: "manual", integrity: "ok", briefBinding: "matched", networkUsed: false } });
    const backupId = String(backup.json?.backupId); expect(backupId).toMatch(/^bkp_/);
    const serialized = `${backup.stdout}${backup.stderr}`;
    expect(serialized).not.toContain(source.root); expect(serialized).not.toContain(source.originalBrief);

    const status = await command(source.root, ["data", "status", "--project", source.root, "--json"]);
    expect(status).toMatchObject({ code: 0, json: { ok: true, command: "data status", currentState: "healthy", restoreAvailable: true, networkUsed: false } });
    expect(status.json?.backups).toEqual([expect.objectContaining({ backupId, valid: true })]);

    const databasePath = join(source.root, ".sestina", "state.sqlite"); const briefPath = join(source.root, ".sestina", "research-brief.yaml");
    const beforeDb = await readFile(databasePath); const beforeBrief = await readFile(briefPath); const beforeEntries = (await readdir(join(source.root, ".sestina"))).sort();
    const preview = await command(source.root, ["data", "restore", backupId, "--project", source.root, "--json"]);
    expect(preview).toMatchObject({ code: 7, json: { ok: false, command: "data restore", backupId, confirmationRequired: true, databaseIntegrity: "ok", briefBinding: "matched", networkUsed: false, exitCode: 7 } });
    expect(await readFile(databasePath)).toEqual(beforeDb); expect(await readFile(briefPath)).toEqual(beforeBrief);
    expect((await readdir(join(source.root, ".sestina"))).sort()).toEqual(beforeEntries);

    const restored = await command(source.root, ["data", "restore", backupId, "--project", source.root, "--yes", "--json"]);
    expect(restored).toMatchObject({ code: 0, json: { ok: true, command: "data restore", restored: true, backupId, databaseIntegrity: "ok", briefBinding: "matched", networkUsed: false } });
    expect(`${restored.stdout}${restored.stderr}`).not.toContain(source.root);
  });

  it("keeps corrupt status read-only and fails invalid restore IDs closed", async () => {
    const source = await initializedFixture();
    const backup = await command(source.root, ["data", "backup", "--project", source.root, "--json"]); expect(backup.code).toBe(0);
    const databasePath = join(source.root, ".sestina", "state.sqlite"); await writeFile(databasePath, "corrupt-cli-canary", "utf8");
    const before = await readFile(databasePath); const beforeStat = await stat(databasePath);
    const status = await command(source.root, ["data", "status", "--project", source.root, "--json"]);
    expect(status).toMatchObject({ code: 0, json: { currentState: "recovery_required", databaseIntegrity: "failed", restoreAvailable: true } });
    expect(await readFile(databasePath)).toEqual(before); expect((await stat(databasePath)).mtimeMs).toBe(beforeStat.mtimeMs);

    expect(await command(source.root, ["data", "restore", "../../outside", "--project", source.root, "--json"])).toMatchObject({ code: 2, json: { ok: false, error: { code: "invalid_input" } } });
    expect(await command(source.root, ["data", "restore", "bkp_20260821T010203004Z_aaaaaaaaaaaa", "--project", source.root, "--json"])).toMatchObject({ code: 4, json: { ok: false, error: { code: "not_found" } } });
  });

  it("does not leak synthetic Brief, artifact, Issue, path, secret, or SQLite details through non-content commands and failures", async () => {
    const source = await initializedFixture();
    const canary = "RI41_BACKGROUND_LOG_CANARY_DO_NOT_EMIT"; const fakeSecret = "sk-test-synthetic-not-a-real-credential";
    const opened = valueOf(await openSestina({ databasePath: join(source.root, ".sestina", "state.sqlite") }));
    try {
      const brief = valueOf(opened.getBriefState(source.projectId)); if (brief === undefined) throw new Error("brief missing");
      const artifact = valueOf(opened.createArtifactWithInitialRevision({
        projectId: source.projectId, actor: USER, kind: "section", relativePath: "paper/private-canary.md",
        content: `${canary}\n${fakeSecret}`, mediaType: "text/markdown",
      }));
      valueOf(opened.openIssue({
        projectId: source.projectId, actor: USER, kind: "evidence_boundary", target: { kind: "artifact", artifactId: artifact.artifact.id },
        violatedCriterion: `${canary} evidence rule`, rationaleConcepts: [canary], summary: `${canary} ${fakeSecret}`,
        sourceArtifactId: artifact.artifact.id, sourceRevisionId: artifact.revision.id,
        sourceRevisionContentHash: artifact.revision.content.contentHash, lineageRootRevisionId: artifact.revision.id,
      }));
    } finally { opened.close(); }

    const outputs = [
      await command(source.root, ["privacy", "show", "--project", source.root, "--json"]),
      await command(source.root, ["doctor", "--project", source.root, "--json"]),
      await command(source.root, ["data", "status", "--project", source.root, "--json"]),
      await command(source.root, ["data", "backup", "--project", source.root, "--json"]),
    ];
    const backupId = String(outputs.at(-1)?.json?.backupId);
    outputs.push(await command(source.root, ["data", "restore", backupId, "--project", source.root, "--json"]));
    outputs.push(await command(source.root, ["data", "restore", "../../outside", "--project", source.root, "--json"]));
    for (const output of outputs) {
      const serialized = `${output.stdout}${output.stderr}`;
      expect(serialized).not.toContain(canary); expect(serialized).not.toContain(fakeSecret); expect(serialized).not.toContain(source.root);
      expect(serialized).not.toMatch(/SQLITE_(?:CORRUPT|BUSY|NOTADB)|database disk image is malformed| at .*recovery\.(?:ts|js):/i);
    }
    expect((await filesUnder(source.root)).filter((path) => /\.(?:log|dmp|crash)$/i.test(path) || /crash[-_]?report/i.test(path))).toEqual([]);
  });
});
