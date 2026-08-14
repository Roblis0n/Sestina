import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import type { StorageDatabase } from "@sestina/storage";
import {
  createProjectService,
  createRootBindingPort,
  canonicalizeRootPath,
} from "../src/index.js";
import { makeTempDir, removeTempDir, makeDb, expectSestinaCodeAsync } from "./helpers.js";

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
