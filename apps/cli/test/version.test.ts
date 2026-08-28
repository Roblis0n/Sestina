import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getReleaseIdentity } from "@sestina/core";
import { runCli, type CliIo } from "../src/main.js";

const roots: string[] = [];

function capture(cwd: string): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = []; const stderr: string[] = [];
  return { stdout, stderr, io: { cwd, isTTY: false, stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) } };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("sestina release version output", () => {
  it("returns the complete stable identity without a project or side effects", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sestina-version-")); roots.push(cwd);
    const output = capture(cwd);
    expect(await runCli(["--version", "--json"], output.io)).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual({ ok: true, command: "version", ...getReleaseIdentity() });
    expect(output.stderr).toEqual([]);
    expect(await readdir(cwd)).toEqual([]);
  });

  it("prints one path-free human line and rejects unrelated arguments", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sestina-version-human-")); roots.push(cwd);
    const output = capture(cwd);
    expect(await runCli(["--version"], output.io)).toBe(0);
    expect(output.stdout.join("")).toBe(`@sestina/cli 0.2.0-rc.1 (${getReleaseIdentity().releaseBuildId})\n`);
    expect(output.stdout.join("")).not.toContain(cwd);
    expect(output.stderr).toEqual([]);

    const invalid = capture(cwd);
    expect(await runCli(["--version", "extra", "--json"], invalid.io)).toBe(2);
  });
});
