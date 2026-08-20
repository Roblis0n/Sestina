import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliDependencies } from "../src/connections/connection-plan.js";
import { runCli, type CliIo } from "../src/main.js";

const roots: string[] = [];

function capture(cwd: string): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { cwd, isTTY: false, stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) } };
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}

async function initializeProject(parent: string, name = "研究 project 😀"): Promise<string> {
  const root = join(parent, name);
  const output = capture(parent);
  expect(await runCli(["init", "--project", root, "--title", "Connection study", "--yes", "--json"], output.io)).toBe(0);
  return root;
}

async function runtimeFixture(parent: string, label = "runtime one"): Promise<CliDependencies["runtimeLocator"]> {
  const packageRoot = join(parent, label, "@sestina", "mcp");
  const serverEntry = join(packageRoot, "dist", "main.js");
  const nodeExecutable = join(parent, label, "Node 24 中文.exe");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), "{}\n", "utf8");
  await writeFile(serverEntry, "export {};\n", "utf8");
  await writeFile(nodeExecutable, "node\n", "utf8");
  return () => Promise.resolve({ ok: true, value: { packageRoot, serverEntry, nodeExecutable } });
}

async function backupDirectories(root: string): Promise<readonly string[]> {
  const directory = join(root, ".sestina", "backups", "host-connections", "codex");
  try { return await readdir(directory); } catch { return []; }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.sequential("project-scoped Codex connection workflow", () => {
  it("previews exact relative paths without --yes and changes no files", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-preview-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    const runtimeLocator = await runtimeFixture(sandbox);
    const beforeState = await readFile(join(project, ".sestina", "state.sqlite"));
    const beforeBrief = await readFile(join(project, ".sestina", "research-brief.yaml"));
    const output = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--host", "codex", "--json"], output.io, { runtimeLocator })).toBe(7);
    expect(JSON.parse(output.stderr.join(""))).toMatchObject({
      ok: false,
      command: "connect",
      host: "codex",
      scope: "project",
      error: { code: "user_confirmation_required" },
      plan: [
        { action: "write", path: ".codex/config.toml" },
        { action: "write", path: ".agents/skills/sestina-research-integrity/SKILL.md" },
        { action: "write", path: ".agents/skills/sestina-research-integrity/agents/openai.yaml" },
      ],
    });
    expect(output.stderr.join("")).not.toContain(project);
    expect(await exists(join(project, ".codex"))).toBe(false);
    expect(await exists(join(project, ".agents"))).toBe(false);
    expect(await readFile(join(project, ".sestina", "state.sqlite"))).toEqual(beforeState);
    expect(await readFile(join(project, ".sestina", "research-brief.yaml"))).toEqual(beforeBrief);

    const human = capture(sandbox);
    expect(await runCli(["connect", "--project", project], human.io, { runtimeLocator })).toBe(7);
    expect(human.stdout.join("")).toMatchInlineSnapshot(`
      "Codex connection plan:
        write .codex/config.toml
        write .agents/skills/sestina-research-integrity/SKILL.md
        write .agents/skills/sestina-research-integrity/agents/openai.yaml
      "
    `);
    expect(human.stderr.join("")).toMatchInlineSnapshot(`"Error: Pass --yes to apply this project-scoped connection plan.\n"`);
  });

  it("connects Unicode paths, reports configured without claiming host verification, and feeds doctor", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-unicode-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    const runtimeLocator = await runtimeFixture(sandbox);
    const output = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], output.io, { runtimeLocator })).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      ok: true,
      command: "connect",
      host: "codex",
      scope: "project",
      state: "configured",
      configuration: "configured",
      hostVerification: "unverified",
      activation: { projectTrustRequired: true, restartRequired: true },
      idempotent: false,
    });
    expect(output.stdout.join("")).not.toContain(project);
    const config = await readFile(join(project, ".codex", "config.toml"), "utf8");
    expect(config).toContain("enabled_tools = [ \"health\", \"get_research_context\" ]");
    expect(config).toContain(project.replaceAll("\\", "\\\\"));
    await access(join(project, ".agents", "skills", "sestina-research-integrity", "SKILL.md"), constants.R_OK);
    expect(await backupDirectories(project)).toEqual([]);

    const status = capture(sandbox);
    expect(await runCli(["connection-status", "--project", project, "--json"], status.io, { runtimeLocator })).toBe(0);
    expect(JSON.parse(status.stdout.join(""))).toMatchObject({
      state: "configured",
      mcp: { status: "configured" },
      skill: { status: "configured" },
      runtime: { status: "available" },
      hostVerification: "unverified",
    });

    const doctor = capture(sandbox);
    expect(await runCli(["doctor", "--project", project, "--json"], doctor.io, { runtimeLocator })).toBe(0);
    expect(JSON.parse(doctor.stdout.join(""))).toMatchObject({
      connection: { state: "configured", hostVerification: "unverified" },
      mcp: { status: "configured" },
      skill: { status: "configured" },
    });
  });

  it("preserves foreign config bytes, is mtime-idempotent, and backs up an owned runtime update", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-preserve-")); roots.push(sandbox);
    const project = await initializeProject(sandbox, "project with spaces");
    await mkdir(join(project, ".codex"), { recursive: true });
    const foreign = "# preserve comment\nmodel = \"gpt-5\"\n\n[mcp_servers.other]\ncommand = \"foreign\"\n# preserve tail";
    await writeFile(join(project, ".codex", "config.toml"), foreign, "utf8");
    const runtimeOne = await runtimeFixture(sandbox, "runtime one");
    const first = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], first.io, { runtimeLocator: runtimeOne })).toBe(0);
    const configPath = join(project, ".codex", "config.toml");
    const firstContent = await readFile(configPath, "utf8");
    expect(firstContent.startsWith(`${foreign}\n`)).toBe(true);
    const firstMtime = (await stat(configPath)).mtimeMs;
    const firstBackups = await backupDirectories(project);
    expect(firstBackups).toHaveLength(1);

    const second = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], second.io, { runtimeLocator: runtimeOne })).toBe(0);
    expect(JSON.parse(second.stdout.join(""))).toMatchObject({ idempotent: true });
    expect((await stat(configPath)).mtimeMs).toBe(firstMtime);
    expect(await backupDirectories(project)).toEqual(firstBackups);

    const runtimeTwo = await runtimeFixture(sandbox, "runtime two");
    const third = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], third.io, { runtimeLocator: runtimeTwo })).toBe(0);
    expect(await readFile(configPath, "utf8")).not.toBe(firstContent);
    const backups = await backupDirectories(project);
    expect(backups).toHaveLength(2);
    const backupFiles = await Promise.all(backups.map(async (name) => {
      const path = join(project, ".sestina", "backups", "host-connections", "codex", name, ".codex", "config.toml");
      try { return await readFile(path, "utf8"); } catch { return undefined; }
    }));
    expect(backupFiles).toContain(firstContent);
  });

  it("fails closed for unmanaged Sestina config, foreign Skill, and malformed ownership markers", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-conflicts-")); roots.push(sandbox);
    const runtimeLocator = await runtimeFixture(sandbox);
    for (const [name, setup] of [
      ["foreign-config", async (root: string) => {
        await mkdir(join(root, ".codex"), { recursive: true });
        await writeFile(join(root, ".codex", "config.toml"), "[mcp_servers.sestina]\ncommand = \"foreign\"\n", "utf8");
      }],
      ["partial-marker", async (root: string) => {
        await mkdir(join(root, ".codex"), { recursive: true });
        await writeFile(join(root, ".codex", "config.toml"), "# >>> sestina managed codex mcp\n", "utf8");
      }],
      ["foreign-skill", async (root: string) => {
        const target = join(root, ".agents", "skills", "sestina-research-integrity");
        await mkdir(target, { recursive: true });
        await writeFile(join(target, "SKILL.md"), "foreign\n", "utf8");
      }],
    ] as const) {
      const project = await initializeProject(sandbox, name);
      await setup(project);
      const output = capture(sandbox);
      expect(await runCli(["connect", "--project", project, "--yes", "--json"], output.io, { runtimeLocator })).toBe(4);
      expect(JSON.parse(output.stderr.join(""))).toMatchObject({ error: { code: "state_conflict" } });
    }
  });

  it("rolls back the first file when committing the second file fails", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-rollback-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    await mkdir(join(project, ".codex"), { recursive: true });
    const original = "# original\nmodel = \"keep\"\n";
    await writeFile(join(project, ".codex", "config.toml"), original, "utf8");
    const runtimeLocator = await runtimeFixture(sandbox);
    const output = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], output.io, {
      runtimeLocator,
      transactionHooks: { beforeCommit: (_path, index) => { if (index === 1) throw new Error("synthetic second write failure"); } },
    })).toBe(6);
    expect(await readFile(join(project, ".codex", "config.toml"), "utf8")).toBe(original);
    expect(await exists(join(project, ".agents", "skills", "sestina-research-integrity", "SKILL.md"))).toBe(false);
    expect(await exists(join(project, ".agents"))).toBe(false);
    expect(output.stderr.join("")).not.toContain("synthetic second write failure");
    expect(output.stderr.join("")).not.toContain(project);
  });

  it("rejects .codex and .agents junctions or symlinks that escape the project", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-links-")); roots.push(sandbox);
    const outside = join(sandbox, "outside");
    await mkdir(outside);
    const runtimeLocator = await runtimeFixture(sandbox);
    for (const segment of [".codex", ".agents"] as const) {
      const project = await initializeProject(sandbox, `escape-${segment.slice(1)}`);
      await symlink(outside, join(project, segment), process.platform === "win32" ? "junction" : "dir");
      const output = capture(sandbox);
      expect(await runCli(["connect", "--project", project, "--yes", "--json"], output.io, { runtimeLocator })).toBe(4);
      expect(output.stderr.join("")).not.toContain(outside);
    }
  });

  it("rejects nested Skill, target-file, and backup junctions that escape the project", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-nested-links-")); roots.push(sandbox);
    const outside = join(sandbox, "outside-nested");
    await mkdir(outside);
    const runtimeLocator = await runtimeFixture(sandbox);
    const cases = [
      async (project: string) => {
        await mkdir(join(project, ".agents"));
        await symlink(outside, join(project, ".agents", "skills"), process.platform === "win32" ? "junction" : "dir");
      },
      async (project: string) => {
        await mkdir(join(project, ".agents", "skills"), { recursive: true });
        await symlink(outside, join(project, ".agents", "skills", "sestina-research-integrity"), process.platform === "win32" ? "junction" : "dir");
      },
      async (project: string) => {
        await mkdir(join(project, ".codex"));
        await symlink(outside, join(project, ".codex", "config.toml"), process.platform === "win32" ? "junction" : "dir");
      },
      async (project: string) => {
        await symlink(outside, join(project, ".sestina", "backups"), process.platform === "win32" ? "junction" : "dir");
      },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const project = await initializeProject(sandbox, `nested-escape-${index}`);
      await cases[index]?.(project);
      const output = capture(sandbox);
      expect(await runCli(["connect", "--project", project, "--yes", "--json"], output.io, { runtimeLocator })).toBe(4);
      expect(output.stderr.join("")).not.toContain(outside);
    }
  });

  it("disconnects only owned bytes, preserves later user config, and leaves Core data unchanged", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-disconnect-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    const runtimeLocator = await runtimeFixture(sandbox);
    const connect = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], connect.io, { runtimeLocator })).toBe(0);
    const configPath = join(project, ".codex", "config.toml");
    await writeFile(configPath, `${await readFile(configPath, "utf8")}\n# user addition after connect\nmodel = "keep-me"\n`, "utf8");
    const databaseBefore = await readFile(join(project, ".sestina", "state.sqlite"));
    const briefBefore = await readFile(join(project, ".sestina", "research-brief.yaml"));

    const preview = capture(sandbox);
    expect(await runCli(["disconnect", "--project", project, "--json"], preview.io, { runtimeLocator })).toBe(7);
    expect(await exists(join(project, ".agents", "skills", "sestina-research-integrity", "SKILL.md"))).toBe(true);

    const removed = capture(sandbox);
    expect(await runCli(["disconnect", "--project", project, "--yes", "--json"], removed.io, { runtimeLocator })).toBe(0);
    expect(JSON.parse(removed.stdout.join(""))).toMatchObject({ state: "not_connected", hostVerification: "unverified", idempotent: false });
    expect(await readFile(configPath, "utf8")).toBe("\n# user addition after connect\nmodel = \"keep-me\"\n");
    expect(await exists(join(project, ".agents", "skills", "sestina-research-integrity"))).toBe(false);
    expect(await readFile(join(project, ".sestina", "state.sqlite"))).toEqual(databaseBefore);
    expect(await readFile(join(project, ".sestina", "research-brief.yaml"))).toEqual(briefBefore);

    const again = capture(sandbox);
    expect(await runCli(["disconnect", "--project", project, "--yes", "--json"], again.io, { runtimeLocator })).toBe(0);
    expect(JSON.parse(again.stdout.join(""))).toMatchObject({ idempotent: true });
  });

  it("refuses partial disconnect after the generated Skill is user-modified", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-disconnect-conflict-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    const runtimeLocator = await runtimeFixture(sandbox);
    const connected = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], connected.io, { runtimeLocator })).toBe(0);
    const configPath = join(project, ".codex", "config.toml");
    const configBefore = await readFile(configPath, "utf8");
    const skillPath = join(project, ".agents", "skills", "sestina-research-integrity", "SKILL.md");
    await writeFile(skillPath, `${await readFile(skillPath, "utf8")}user edit\n`, "utf8");
    const output = capture(sandbox);
    expect(await runCli(["disconnect", "--project", project, "--yes", "--json"], output.io, { runtimeLocator })).toBe(4);
    expect(await readFile(configPath, "utf8")).toBe(configBefore);
    expect(await readFile(skillPath, "utf8")).toContain("user edit");
  });

  it("distinguishes missing, drifted, runtime unavailable, and foreign conflict states", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-status-states-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    const runtimeLocator = await runtimeFixture(sandbox);
    const status = async (dependencies: CliDependencies = { runtimeLocator }) => {
      const output = capture(sandbox);
      expect(await runCli(["connection-status", "--project", project, "--json"], output.io, dependencies)).toBe(0);
      return JSON.parse(output.stdout.join("")) as { state: string };
    };
    expect((await status()).state).toBe("not_connected");
    const connected = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], connected.io, { runtimeLocator })).toBe(0);
    await rm(join(project, ".agents", "skills", "sestina-research-integrity", "agents", "openai.yaml"));
    expect((await status()).state).toBe("drifted");
    await writeFile(join(project, ".agents", "skills", "sestina-research-integrity", "foreign.txt"), "foreign\n", "utf8");
    expect((await status()).state).toBe("conflict");
    await rm(join(project, ".agents"), { recursive: true, force: true });
    expect((await status({ runtimeLocator: () => Promise.resolve({ ok: false, error: { code: "runtime_unavailable" } }) })).state).toBe("runtime_unavailable");
  });

  it("rejects unsupported hosts without changing the project", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-host-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    const output = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--host", "claude", "--yes", "--json"], output.io)).toBe(8);
    expect(JSON.parse(output.stderr.join(""))).toMatchObject({ error: { code: "unsupported_format" } });
    expect(await exists(join(project, ".codex"))).toBe(false);
  });

  it("rejects a missing or package-escaping MCP runtime before writing configuration", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-connect-runtime-")); roots.push(sandbox);
    const project = await initializeProject(sandbox);
    const packageRoot = join(sandbox, "runtime", "mcp");
    const outsideEntry = join(sandbox, "runtime", "outside-main.js");
    const nodeExecutable = join(sandbox, "runtime", "node.exe");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), "{}\n", "utf8");
    await writeFile(outsideEntry, "export {};\n", "utf8");
    await writeFile(nodeExecutable, "node\n", "utf8");
    const output = capture(sandbox);
    expect(await runCli(["connect", "--project", project, "--yes", "--json"], output.io, {
      runtimeLocator: () => Promise.resolve({ ok: true, value: { packageRoot, serverEntry: outsideEntry, nodeExecutable } }),
    })).toBe(6);
    expect(JSON.parse(output.stderr.join(""))).toMatchObject({ error: { code: "runtime_unavailable" } });
    expect(await exists(join(project, ".codex"))).toBe(false);
    expect(await exists(join(project, ".agents"))).toBe(false);
  });
});
