import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectReader } from "../src/project-reader.js";
import {
  canonicalPathWithin,
  resolveProjectStatePaths,
} from "../src/security/path-guard.js";
import {
  createProjectFixture,
  FIXTURE_PREFIX,
  removeProjectFixture,
} from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  for (const root of cleanup.splice(0)) await removeProjectFixture(root);
});

function options(projectRoot: string) {
  return { projectRoot, outputLimitBytes: 32_768, queryTimeoutMs: 2_000 };
}

describe.sequential("@sestina/mcp project path security", () => {
  it("rejects a .sestina junction or symlink whose canonical target escapes the project", async () => {
    const outside = await createProjectFixture();
    const project = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
    cleanup.push(project, outside.root);
    await symlink(
      join(outside.root, ".sestina"),
      join(project, ".sestina"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await openProjectReader(options(project));
    if (result.ok) result.value.close();
    expect(result).toMatchObject({ ok: false, error: { code: "project_state_unavailable" } });
    expect(JSON.stringify(result)).not.toContain(project);
    expect(JSON.stringify(result)).not.toContain(outside.root);
  });

  it.skipIf(process.platform === "win32")("rejects a state.sqlite symlink whose canonical target escapes the project", async () => {
    const outside = await createProjectFixture();
    const project = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
    cleanup.push(project, outside.root);
    await mkdir(join(project, ".sestina"));
    await symlink(outside.databasePath, join(project, ".sestina", "state.sqlite"), "file");

    const result = await openProjectReader(options(project));
    if (result.ok) result.value.close();
    expect(result).toMatchObject({ ok: false, error: { code: "project_state_unavailable" } });
    expect(JSON.stringify(result)).not.toContain(outside.databasePath);
  });

  it("uses canonical path.relative containment rather than a similar string prefix", () => {
    const root = join(tmpdir(), "project");
    expect(canonicalPathWithin(root, join(root, ".sestina"))).toBe(true);
    expect(canonicalPathWithin(root, join(tmpdir(), "project-evil", ".sestina"))).toBe(false);
    expect(canonicalPathWithin(root, root)).toBe(true);
  });

  it("rejects missing roots, file roots, and a directory masquerading as state.sqlite without leaking paths", async () => {
    const fileRoot = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
    const fakeDatabaseRoot = await mkdtemp(join(tmpdir(), FIXTURE_PREFIX));
    cleanup.push(fileRoot, fakeDatabaseRoot);
    const filePath = join(fileRoot, "not-a-directory");
    await writeFile(filePath, "x", "utf8");
    await mkdir(join(fakeDatabaseRoot, ".sestina", "state.sqlite"), { recursive: true });

    const missing = join(tmpdir(), `${FIXTURE_PREFIX}missing-secret-target`);
    for (const [target, code] of [
      [missing, "invalid_project_root"],
      [filePath, "invalid_project_root"],
      [fakeDatabaseRoot, "project_state_unavailable"],
    ] as const) {
      const result = await resolveProjectStatePaths(target);
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain(target);
      expect(JSON.stringify(result)).not.toContain("missing-secret-target");
    }
  });

});
