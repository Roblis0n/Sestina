import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { generateId } from "@sestina/schema";
import { sha256, createUnitOfWork, type StorageDatabase } from "@sestina/storage";
import {
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
  seed,
  expectSestinaCode,
  T0,
} from "./helpers.js";

describe("project discovery (docs/30 §4)", () => {
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

  it("creates a discovered project for an unrecognized root", async () => {
    const discovery = createProjectDiscovery(db);
    const root = join(dir, "fresh-root");
    const result = await discovery.discover(root);
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.project.name).toBe("fresh-root");
    expect(result.project.status).toBe("active");
    const binding = result.project.bindings[0];
    expect(binding?.rootPath).toBe(canonicalizeRootPath(root, true));
    expect(binding?.source).toBe("discovered");
    expect(binding?.confirmed).toBe(false);
  });

  it("attaches to the project already bound at the canonical root", async () => {
    const projects = createProjectService(db);
    const discovery = createProjectDiscovery(db);
    const root = join(dir, "known-root");
    const created = await projects.createProject({ name: "Known", roots: [root] });
    const result = await discovery.discover(root);
    expect(result.kind).toBe("attached");
    if (result.kind !== "attached") return;
    expect(result.project.projectId).toBe(created.projectId);
  });

  it("queues unowned host events with the exact raw payload retained", () => {
    const discovery = createProjectDiscovery(db);
    const rawEvent = '{"type":"turn.started","session":"hs-1"}';
    discovery.enqueueUnowned({
      host: "codex",
      hostSessionId: "hs-1",
      occurredAt: T0,
      reason: "no_project",
      rawEvent,
    });
    const pending = discovery.listPending({ limit: 10 });
    expect(pending.items).toHaveLength(1);
    const queued = pending.items[0];
    expect(queued?.rawEvent).toBe(rawEvent);
    expect(queued?.payloadHash).toBe(sha256(rawEvent));
    expect(queued?.reason).toBe("no_project");

    // Resolution attributes to REAL seeded rows: dangling targets are
    // refused by the service (pinned in the test below), so the happy path
    // resolves to a genuine project and task (docs/30 §10 batch attribution).
    const project = makeProject();
    const task = makeTask(project.projectId);
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
    });
    discovery.resolve(queued?.unownedId ?? "", {
      projectId: project.projectId,
      taskId: task.taskId,
    });
    expect(discovery.listPending({ limit: 10 }).items).toHaveLength(0);
    const resolved = createUnitOfWork(db).unownedActivity.get(queued?.unownedId ?? "");
    expect(resolved?.resolvedProjectId).toBe(project.projectId);
    expect(resolved?.resolvedTaskId).toBe(task.taskId);

    // A second resolve of the same activity is an idempotency violation.
    expectSestinaCode(() => {
      discovery.resolve(queued?.unownedId ?? "", {
        projectId: project.projectId,
        taskId: task.taskId,
      });
    }, "idempotency_violation");
  });

  it("refuses to resolve queue items to missing or cross-project targets", () => {
    const discovery = createProjectDiscovery(db);
    const activity = discovery.enqueueUnowned({
      host: "codex",
      hostSessionId: "hs-dangling",
      occurredAt: T0,
      reason: "no_project",
      rawEvent: '{"type":"turn.started"}',
    });
    // A project that does not exist cannot be the resolution target —
    // a mistyped id must not bury the retained raw event.
    expectSestinaCode(() => {
      discovery.resolve(activity.unownedId, { projectId: generateId(), taskId: null });
    }, "validation_failed");
    // A task from another project cannot be the resolution target either.
    const project = makeProject();
    seed(db, (u) => {
      u.projects.insert(project);
    });
    expectSestinaCode(() => {
      discovery.resolve(activity.unownedId, {
        projectId: project.projectId,
        taskId: generateId(),
      });
    }, "validation_failed");
    // The refused attributions left the activity pending.
    const pending = discovery.listPending({ limit: 10 }).items;
    expect(pending.map((a) => a.unownedId)).toEqual([activity.unownedId]);
  });

  it("resolves to a project without a task (project-level attribution)", () => {
    const project = makeProject();
    seed(db, (u) => {
      u.projects.insert(project);
    });
    const discovery = createProjectDiscovery(db);
    const activity = discovery.enqueueUnowned({
      host: "claude_code",
      hostSessionId: "hs-project-only",
      occurredAt: T0,
      reason: "root_conflict",
      rawEvent: '{"type":"stop"}',
    });
    discovery.resolve(activity.unownedId, { projectId: project.projectId, taskId: null });
    const resolved = createUnitOfWork(db).unownedActivity.get(activity.unownedId);
    expect(resolved?.resolvedProjectId).toBe(project.projectId);
    expect(resolved?.resolvedTaskId).toBeUndefined();
    expect(discovery.listPending({ limit: 10 }).items).toHaveLength(0);
  });

  it("survives two concurrent discoveries of the same fresh root", async () => {
    const discovery = createProjectDiscovery(db);
    const root = join(dir, "concurrent-root");
    const [first, second] = await Promise.allSettled([
      discovery.discover(root),
      discovery.discover(root),
    ]);
    // Both calls must resolve — the loser re-reads the winner's binding
    // instead of throwing an idempotency violation out of the pipeline.
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    const kinds = [first, second].map((r) =>
      r.status === "fulfilled" ? r.value.kind : "rejected",
    );
    expect(kinds).toContain("created");
    expect(kinds).toContain("attached");
    const projectIds = [first, second].map((r) =>
      r.status === "fulfilled" && r.value.kind !== "needs_confirmation"
        ? r.value.project.projectId
        : "",
    );
    expect(projectIds[0]).not.toBe("");
    expect(projectIds[0]).toBe(projectIds[1]);
  });
});
