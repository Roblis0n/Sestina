import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { createUnitOfWork, type StorageDatabase } from "@sestina/storage";
import {
  createProjectDiscovery,
  createProjectService,
  canonicalizeRootPath,
} from "../src/index.js";
import { makeTempDir, removeTempDir, makeDb, makeTask, seed } from "./helpers.js";

const GIT_REMOTE = "https://example.com/org/movable.git";

describe("path moves (docs/30 §4 re-association)", () => {
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

  it("offers confirmation for a moved root instead of duplicating the project", async () => {
    const projects = createProjectService(db);
    const discovery = createProjectDiscovery(db);
    const oldRoot = join(dir, "old-location");
    const newRoot = join(dir, "new-location");
    const created = await projects.createProject({
      name: "Movable",
      roots: [oldRoot],
      gitRemote: GIT_REMOTE,
    });
    const moved = await discovery.discover(newRoot, { gitRemote: GIT_REMOTE });
    // The remote fingerprint matches across paths — human confirmation, not
    // a silent duplicate project (docs/30 §4).
    expect(moved.kind).toBe("needs_confirmation");
    if (moved.kind !== "needs_confirmation") return;
    expect(moved.candidates.map((p) => p.projectId)).toEqual([created.projectId]);
  });

  it("repoints the binding on user confirmation and preserves project history", async () => {
    const projects = createProjectService(db);
    const discovery = createProjectDiscovery(db);
    const oldRoot = join(dir, "old-location");
    const newRoot = join(dir, "new-location");
    const created = await projects.createProject({
      name: "Movable",
      roots: [oldRoot],
      gitRemote: GIT_REMOTE,
    });
    const task = makeTask(created.projectId, { status: "active" });
    seed(db, (u) => {
      u.tasks.insert(task);
    });

    const repointed = await projects.repointRoot(created.projectId, oldRoot, newRoot, {
      gitRemote: GIT_REMOTE,
    });
    expect(repointed.projectId).toBe(created.projectId);
    // The old binding is archived; the new one is active and user-confirmed.
    const newBinding = repointed.bindings.find((b) => b.rootPath === canonicalizeRootPath(newRoot, true));
    expect(newBinding?.source).toBe("user_confirmed");
    expect(newBinding?.confirmed).toBe(true);
    expect(repointed.bindings.some((b) => b.rootPath === canonicalizeRootPath(oldRoot, true))).toBe(
      false,
    );

    // History survives the move: same project, same task.
    expect(projects.getProject(created.projectId)?.projectId).toBe(created.projectId);
    expect(createUnitOfWork(db).tasks.get(created.projectId, task.taskId)?.title).toBe(task.title);

    // And the moved root now discovers straight to the project.
    const result = await discovery.discover(newRoot, { gitRemote: GIT_REMOTE });
    expect(result.kind).toBe("attached");
    if (result.kind !== "attached") return;
    expect(result.project.projectId).toBe(created.projectId);
  });

  it("does not match a moved root without a git remote", async () => {
    const projects = createProjectService(db);
    const discovery = createProjectDiscovery(db);
    const oldRoot = join(dir, "remote-less-old");
    const newRoot = join(dir, "remote-less-new");
    await projects.createProject({ name: "NoRemote", roots: [oldRoot] });
    // Path-only fingerprints cannot cross paths: the moved root looks new.
    const result = await discovery.discover(newRoot);
    expect(result.kind).toBe("created");
  });
});
