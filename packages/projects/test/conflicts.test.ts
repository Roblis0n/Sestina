import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { sha256, type StorageDatabase } from "@sestina/storage";
import {
  resolveProjectAndTask,
  createProjectDiscovery,
  createProjectService,
} from "../src/index.js";
import {
  makeTempDir,
  removeTempDir,
  makeDb,
  makeProject,
  makeTask,
  makeSession,
  seed,
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
