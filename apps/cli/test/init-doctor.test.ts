import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";

const roots: string[] = [];

function capture(cwd: string, isTTY = false): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { cwd, isTTY, stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("sestina init and doctor", () => {
  it("initializes a new local project, remains idempotent, and diagnoses it offline", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-cli-")); roots.push(sandbox);
    const projectRoot = join(sandbox, "portable-project");
    const first = capture(sandbox);
    expect(await runCli(["init", "--project", projectRoot, "--title", "Portable study", "--yes", "--json"], first.io)).toBe(0);
    const firstJson = JSON.parse(first.stdout.join("")) as Record<string, unknown>;
    expect(firstJson).toMatchObject({ ok: true, command: "init", initialized: true, idempotent: false, gitignoreSuggestion: ".sestina/" });
    await access(join(projectRoot, ".sestina", "state.sqlite"), constants.R_OK | constants.W_OK);
    const briefPath = join(projectRoot, ".sestina", "research-brief.yaml");
    const briefBefore = await readFile(briefPath, "utf8");
    const modifiedBefore = (await stat(briefPath)).mtimeMs;
    expect(briefBefore).toContain("status: draft");
    await expect(access(join(projectRoot, ".gitignore"))).rejects.toBeDefined();

    const second = capture(sandbox);
    expect(await runCli(["init", "--project", projectRoot, "--title", "Portable study", "--yes", "--json"], second.io)).toBe(0);
    expect(JSON.parse(second.stdout.join(""))).toMatchObject({ ok: true, initialized: true, idempotent: true });
    expect(await readFile(briefPath, "utf8")).toBe(briefBefore);
    expect((await stat(briefPath)).mtimeMs).toBe(modifiedBefore);

    const doctor = capture(sandbox);
    expect(await runCli(["doctor", "--project", projectRoot, "--json"], doctor.io)).toBe(0);
    const report = JSON.parse(doctor.stdout.join("")) as Record<string, unknown>;
    expect(report).toMatchObject({
      ok: true,
      command: "doctor",
      database: { readable: true, writable: true, integrity: "ok" },
      schema: { status: "current" },
      brief: { status: "draft_not_activated" },
      backup: { status: "ok" },
      mcp: { status: "not_configured" },
      skill: { status: "not_configured" },
    });
  });

  it("fails closed for missing non-interactive inputs and a non-empty foreign state directory", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-cli-conflict-")); roots.push(sandbox);
    const missing = capture(sandbox);
    expect(await runCli(["init", "--json"], missing.io)).toBe(2);
    expect(missing.stderr.join("")).not.toContain(sandbox);

    const projectRoot = join(sandbox, "existing");
    await mkdir(join(projectRoot, ".sestina"), { recursive: true });
    await writeFile(join(projectRoot, ".sestina", "foreign.txt"), "preserve me", "utf8");
    const conflict = capture(sandbox);
    expect(await runCli(["init", "--project", projectRoot, "--title", "Existing", "--yes", "--json"], conflict.io)).toBe(4);
    expect(await readFile(join(projectRoot, ".sestina", "foreign.txt"), "utf8")).toBe("preserve me");
    expect(conflict.stderr.join("")).not.toContain(sandbox);
  });

  it("uses project-not-initialized and infrastructure exit codes without leaking absolute paths", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "sestina-cli-doctor-")); roots.push(sandbox);
    const absent = capture(sandbox);
    expect(await runCli(["doctor", "--project", sandbox, "--json"], absent.io)).toBe(3);
    expect(absent.stderr.join("")).not.toContain(sandbox);

    await mkdir(join(sandbox, ".sestina"), { recursive: true });
    await writeFile(join(sandbox, ".sestina", "state.sqlite"), "not a database", "utf8");
    await writeFile(join(sandbox, ".sestina", "research-brief.yaml"), "status: draft\n", "utf8");
    const corrupt = capture(sandbox);
    expect(await runCli(["doctor", "--project", sandbox, "--json"], corrupt.io)).toBe(6);
    expect(corrupt.stderr.join("")).not.toContain(sandbox);
  });
});
