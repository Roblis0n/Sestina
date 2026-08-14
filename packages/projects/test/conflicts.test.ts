import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { sha256, type StorageDatabase } from "@sestina/storage";
import {
  resolveProjectAndTask,
  createProjectDiscovery,
  createProjectService,
  canonicalizeRootPath,
} from "../src/index.js";
import {
  makeTempDir,
  removeTempDir,
  makeDb,
  makeProject,
  makeTask,
  makeSession,
  seed,
  expectSestinaCodeAsync,
  T0,
} from "./helpers.js";

const GIT_REMOTE = "https://example.com/org/shared.git";

describe("unresolvable host activity (docs/30 §10)", () => {
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

  it("resolves to an existing session's project and task", async () => {
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    const session = makeSession({ taskId: task.taskId });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(project.projectId, session);
    });
    const result = await resolveProjectAndTask(db, {
      host: session.host,
      hostSessionId: session.hostSessionId,
    });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.project.projectId).toBe(project.projectId);
    expect(result.taskResolution).toBe("attached");
    expect(result.attachedTaskId).toBe(task.taskId);
  });

  it("queues raw events as unowned when no project can be attributed", async () => {
    const rawEvent = '{"type":"pre_tool","session":"orphan-1"}';
    const result = await resolveProjectAndTask(db, {
      host: "codex",
      hostSessionId: "orphan-1",
      rawEvent,
      occurredAt: T0,
    });
    expect(result.kind).toBe("unowned");
    if (result.kind !== "unowned") return;
    expect(result.reason).toBe("no_project");
    expect(result.unownedId).toBeDefined();

    const discovery = createProjectDiscovery(db);
    const queued = discovery.listPending({ limit: 10 }).items;
    expect(queued).toHaveLength(1);
    expect(queued[0]?.rawEvent).toBe(rawEvent);
    expect(queued[0]?.payloadHash).toBe(sha256(rawEvent));
  });

  it("reports root conflicts for archived-project roots instead of re-attaching", async () => {
    const root = join(dir, "archived-root");
    const projects = createProjectService(db);
    const created = await projects.createProject({ name: "Gone", roots: [root] });
    projects.archiveProject(created.projectId);

    const rawEvent = '{"type":"turn.started","session":"archived-host"}';
    const result = await resolveProjectAndTask(db, {
      host: "codex",
      hostSessionId: "archived-host",
      rootPath: root,
      rawEvent,
      occurredAt: T0,
    });
    expect(result.kind).toBe("unowned");
    if (result.kind !== "unowned") return;
    expect(result.reason).toBe("root_conflict");
  });

  it("reports ambiguous bindings when a moved root matches multiple projects", async () => {
    const projects = createProjectService(db);
    const rootA = join(dir, "amb-a");
    const rootB = join(dir, "amb-b");
    await projects.createProject({ name: "Ambiguous A", roots: [rootA], gitRemote: GIT_REMOTE });
    await projects.createProject({ name: "Ambiguous B", roots: [rootB], gitRemote: GIT_REMOTE });

    // A third path with the same remote matches both projects — never
    // silently attach; the activity waits for human attribution.
    const thirdRoot = join(dir, "amb-c");
    const result = await resolveProjectAndTask(db, {
      host: "codex",
      hostSessionId: "amb-host",
      rootPath: thirdRoot,
      rawEvent: '{"type":"stop"}',
      occurredAt: T0,
      gitRemote: GIT_REMOTE,
    });
    expect(result.kind).toBe("unowned");
    if (result.kind !== "unowned") return;
    expect(result.reason).toBe("ambiguous_binding");
  });

  it("resolves a fresh root by creating the discovered project and a shell session", async () => {
    const root = join(dir, "fresh-conflict-root");
    const result = await resolveProjectAndTask(db, {
      host: "claude_code",
      hostSessionId: "fresh-host",
      rootPath: root,
    });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.taskResolution).toBe("created_shell");
    expect(result.project.name).toBe("fresh-conflict-root");
  });
});

describe("binding conflict error codes (docs/30 §10 human review)", () => {
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

  it("refuses creating a project at an already-bound root with validation_failed", async () => {
    const projects = createProjectService(db);
    const root = join(dir, "taken-root");
    await projects.createProject({ name: "Owner", roots: [root] });
    // A binding conflict goes to human review as validation_failed, never
    // a duplicate-detected idempotency violation (docs/30 §10).
    await expectSestinaCodeAsync(
      () => projects.createProject({ name: "Usurper", roots: [root] }),
      "validation_failed",
    );
  });

  it("refuses duplicate roots inside one createProject call", async () => {
    const projects = createProjectService(db);
    const root = join(dir, "dup-input-root");
    await expectSestinaCodeAsync(
      () => projects.createProject({ name: "Dup", roots: [root, root] }),
      "validation_failed",
    );
  });

  it("refuses repointing onto a root that already has an active binding", async () => {
    const projects = createProjectService(db);
    const rootA = join(dir, "repoint-from");
    const rootB = join(dir, "repoint-to");
    const mover = await projects.createProject({ name: "Mover", roots: [rootA] });
    await projects.createProject({ name: "Occupier", roots: [rootB] });
    await expectSestinaCodeAsync(
      () => projects.repointRoot(mover.projectId, rootA, rootB),
      "validation_failed",
    );
    // The original binding is untouched by the refused repoint.
    expect(projects.getProject(mover.projectId)?.bindings.map((b) => b.rootPath)).toEqual([
      canonicalizeRootPath(rootA, true),
    ]);
  });

  it("distinguishes same-name projects with root alias and short id (docs/30 §10)", async () => {
    const projects = createProjectService(db);
    const root = join(dir, "same-name-root");
    const created = await projects.createProject({ name: "Twin", roots: [root] });
    const label = projects.displayLabel(created);
    expect(label).toContain("Twin");
    expect(label).toContain("same-name-root");
    expect(label).toContain(created.projectId.slice(0, 8));
    // listProjects must carry bindings so the UI can render the alias for
    // same-name projects (docs/30 §10: alias + stable id suffix).
    const listed = projects
      .listProjects({ limit: 10 })
      .items.find((p) => p.projectId === created.projectId);
    expect(listed?.bindings).toHaveLength(1);
    expect(listed?.bindings[0]?.rootPath).toBe(canonicalizeRootPath(root, true));
  });
});
