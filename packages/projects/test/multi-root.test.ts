import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import type { StorageDatabase } from "@sestina/storage";
import {
  createProjectService,
  createProjectDiscovery,
  createRootBindingPort,
  canonicalizeRootPath,
} from "../src/index.js";
import { makeTempDir, removeTempDir, makeDb, expectSestinaCodeAsync } from "./helpers.js";

const GIT_REMOTE = "https://example.com/org/multi-root.git";

describe("multi-root projects (docs/30 §3/§4)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await makeDb(dir);
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("lets the user add a second root explicitly", async () => {
    const projects = createProjectService(db);
    const rootA = join(dir, "root-a");
    const rootB = join(dir, "root-b");
    const created = await projects.createProject({ name: "Multi", roots: [rootA] });

    const updated = await projects.addRoot(created.projectId, rootB);
    expect(updated.bindings.map((b) => b.rootPath)).toEqual([
      canonicalizeRootPath(rootA, true),
      canonicalizeRootPath(rootB, true),
    ]);
    // Roots are user-added and confirmed by construction.
    expect(updated.bindings.every((b) => b.source === "user_added" && b.confirmed)).toBe(true);
  });

  it("rejects adding the same root twice", async () => {
    const projects = createProjectService(db);
    const root = join(dir, "dup-root");
    const created = await projects.createProject({ name: "Dup", roots: [root] });
    await expectSestinaCodeAsync(
      () => projects.addRoot(created.projectId, root),
      "validation_failed",
    );
  });

  it("rejects adding a root already actively bound to another project", async () => {
    const projects = createProjectService(db);
    const root = join(dir, "shared-root");
    const first = await projects.createProject({ name: "First", roots: [root] });
    const second = await projects.createProject({ name: "Second", roots: [join(dir, "other-root")] });
    await expectSestinaCodeAsync(
      () => projects.addRoot(second.projectId, root),
      "validation_failed",
    );
    expect(projects.getProject(first.projectId)?.bindings).toHaveLength(1);
  });

  it("adds a same-remote worktree root to the same project (docs/30 §4)", async () => {
    const projects = createProjectService(db);
    const discovery = createProjectDiscovery(db);
    const main = join(dir, "repo-main");
    const worktree = join(dir, "repo-feature");
    const created = await projects.createProject({
      name: "Worktree",
      roots: [main],
      gitRemote: GIT_REMOTE,
    });

    // A Git worktree may belong to the same project, each root binding
    // saved separately (docs/30 §4) — the shared remote must not block it.
    const updated = await projects.addRoot(created.projectId, worktree, {
      gitRemote: GIT_REMOTE,
    });
    expect(updated.bindings.map((b) => b.rootPath)).toEqual([
      canonicalizeRootPath(main, true),
      canonicalizeRootPath(worktree, true),
    ]);
    expect(updated.bindings.every((b) => b.source === "user_added" && b.confirmed)).toBe(true);

    // Discovery at the worktree path attaches through its own binding.
    const result = await discovery.discover(worktree, { gitRemote: GIT_REMOTE });
    expect(result.kind).toBe("attached");
    if (result.kind !== "attached") return;
    expect(result.project.projectId).toBe(created.projectId);
  });

  it("rejects a same-remote root that another project claims", async () => {
    const projects = createProjectService(db);
    const rootA = join(dir, "remote-a");
    const rootB = join(dir, "remote-b");
    await projects.createProject({ name: "Holder", roots: [rootA], gitRemote: GIT_REMOTE });
    const claimant = await projects.createProject({ name: "Claimant", roots: [rootB] });

    // The remote fingerprint belongs to the Holder project; a worktree of
    // it may not be claimed by another project (no auto-merge by remote).
    await expectSestinaCodeAsync(
      () => projects.addRoot(claimant.projectId, join(dir, "remote-c"), { gitRemote: GIT_REMOTE }),
      "validation_failed",
    );
  });

  it("archives a removed root without deleting binding history", async () => {
    const projects = createProjectService(db);
    const bindings = createRootBindingPort(db);
    const rootA = join(dir, "keep-root");
    const rootB = join(dir, "remove-root");
    const created = await projects.createProject({ name: "History", roots: [rootA, rootB] });

    const updated = projects.removeRoot(created.projectId, rootB);
    expect(updated.bindings.map((b) => b.rootPath)).toEqual([canonicalizeRootPath(rootA, true)]);

    // The archived binding row is preserved, not deleted (docs/30 §6).
    const all = bindings.listByProject(created.projectId);
    expect(all.map((b) => `${b.rootPath}:${b.status}`)).toContain(
      `${canonicalizeRootPath(rootB, true)}:archived`,
    );
  });
});
