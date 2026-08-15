import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateId } from "@sestina/schema";
import { hostSessionIdentity } from "@sestina/events";
import { createUnitOfWork, type StorageDatabase } from "@sestina/storage";
import { createHostSessionService } from "../src/index.js";
import {
  makeTempDir,
  removeTempDir,
  makeDb,
  makeProject,
  makeTask,
  makeSession,
  makeContract,
  seed,
  expectSestinaCodeAsync,
  T0,
  T1,
} from "./helpers.js";

function seedProjectWithTwoActiveTasks(db: StorageDatabase) {
  const project = makeProject();
  const taskA = makeTask(project.projectId, { status: "active", title: "task A" });
  const taskB = makeTask(project.projectId, { status: "active", title: "task B" });
  seed(db, (u) => {
    u.projects.insert(project);
    u.tasks.insert(taskA);
    u.tasks.insert(taskB);
  });
  return { project, taskA, taskB };
}

function sessionInput(projectId: string) {
  return {
    host: "codex" as const,
    hostSessionId: `host-${generateId()}`,
    projectId,
    visibilityLevel: "tool_lifecycle" as const,
    capabilities: ["tool_interception"],
    startedAt: T0,
  };
}

describe("session resolution and task attach (docs/22 Task 8 Step 1, docs/30 §5)", () => {
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

  it("places a session in ambiguity review when two tasks are active", async () => {
    const { project, taskA, taskB } = seedProjectWithTwoActiveTasks(db);
    const sessions = createHostSessionService(db);
    const result = await sessions.resolveOnStart(sessionInput(project.projectId));
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.attachedTaskId).toBeUndefined();
    expect(result.candidateTaskIds).toHaveLength(2);
    expect(new Set(result.candidateTaskIds)).toEqual(
      new Set([taskA.taskId, taskB.taskId]),
    );
    // The session row exists but stays unattached — no silent guessing.
    expect(result.hostSession.taskId).toBeUndefined();
  });

  it("auto-attaches when exactly one task is active and writes an association event", async () => {
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    const dormant = makeTask(project.projectId, { status: "completed" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.tasks.insert(dormant);
    });
    const sessions = createHostSessionService(db);
    const result = await sessions.resolveOnStart(sessionInput(project.projectId));
    expect(result.kind).toBe("attached");
    if (result.kind !== "attached") return;
    expect(result.attachedTaskId).toBe(task.taskId);
    expect(result.hostSession.taskId).toBe(task.taskId);

    const uow = createUnitOfWork(db);
    expect(uow.sessionAttachments.current(project.projectId, result.hostSession.sessionId)?.taskId).toBe(
      task.taskId,
    );
    const events = uow.events.listByProject(project.projectId, { limit: 10 }).items;
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("session_attachment");
  });

  it("creates an unattached shell session when no task is active", async () => {
    const project = makeProject();
    const draft = makeTask(project.projectId, { status: "draft" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(draft);
    });
    const sessions = createHostSessionService(db);
    const result = await sessions.resolveOnStart(sessionInput(project.projectId));
    expect(result.kind).toBe("created_shell");
    expect(result.hostSession.taskId).toBeUndefined();
    expect(result.hostSession.projectId).toBe(project.projectId);
  });

  it("resolves concurrent starts of the same host session without errors", async () => {
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
    });
    const sessions = createHostSessionService(db);
    const input = sessionInput(project.projectId);
    const [first, second] = await Promise.allSettled([
      sessions.resolveOnStart(input),
      sessions.resolveOnStart(input),
    ]);
    // Both starts must resolve — the loser re-reads the winner's row on
    // the natural-key constraint instead of throwing idempotency_violation.
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    const ids = [first, second].map((r) =>
      r.status === "fulfilled" ? r.value.hostSession.sessionId : "",
    );
    expect(ids[0]).not.toBe("");
    expect(ids[0]).toBe(ids[1]);
    const uow = createUnitOfWork(db);
    expect(uow.sessions.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);
  });

  it("takes the census beyond the first 500 tasks before deciding auto-attach", async () => {
    const project = makeProject();
    const dormant = Array.from({ length: 500 }, (_, i) =>
      makeTask(project.projectId, {
        status: "completed",
        createdAt: new Date(Date.parse(T0) + i * 1000).toISOString(),
      }),
    );
    const active = makeTask(project.projectId, {
      status: "active",
      createdAt: new Date(Date.parse(T0) + 500 * 1000).toISOString(),
    });
    seed(db, (u) => {
      u.projects.insert(project);
      for (const task of dormant) u.tasks.insert(task);
      u.tasks.insert(active);
    });
    const sessions = createHostSessionService(db);
    const result = await sessions.resolveOnStart(sessionInput(project.projectId));
    // The sole active task sits on the second page — the census must page
    // through it instead of silently reporting a shell session (docs/30 §5).
    expect(result.kind).toBe("attached");
    if (result.kind !== "attached") return;
    expect(result.attachedTaskId).toBe(active.taskId);
  });

  it("re-resolves the same host session idempotently to the same session", async () => {
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
    });
    const sessions = createHostSessionService(db);
    const input = sessionInput(project.projectId);
    const first = await sessions.resolveOnStart(input);
    const second = await sessions.resolveOnStart(input);
    expect(second.kind).toBe("existing");
    if (second.kind !== "existing") return;
    expect(second.hostSession.sessionId).toBe(first.hostSession.sessionId);
    // The derived id is the canonical host-session mapping.
    expect(first.hostSession.sessionId).toBe(await hostSessionIdentity("codex", input.hostSessionId));
    const uow = createUnitOfWork(db);
    expect(uow.sessions.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);
  });

  it("refuses new sessions for archived projects", async () => {
    const project = makeProject({ status: "archived" });
    const task = makeTask(project.projectId, { status: "active" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
    });
    const sessions = createHostSessionService(db);
    await expectSestinaCodeAsync(
      () => sessions.resolveOnStart(sessionInput(project.projectId)),
      "validation_failed",
    );
    const uow = createUnitOfWork(db);
    expect(uow.sessions.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(0);
  });

  it("re-attaching to the current task is a no-op that preserves the history", async () => {
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    const session = makeSession({ taskId: task.taskId });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(project.projectId, session);
      u.sessionAttachments.insert({
        attachmentId: generateId(),
        sessionId: session.sessionId,
        projectId: project.projectId,
        taskId: task.taskId,
        attachedAt: T0,
      });
    });
    const sessions = createHostSessionService(db);
    // A crash retry (same target task, regenerated occurredAt) must not
    // churn the append-only history or the association event stream.
    await sessions.attach(project.projectId, session.sessionId, task.taskId, {
      reason: "retry of the same attach",
      occurredAt: T1,
    });
    const uow = createUnitOfWork(db);
    expect(uow.sessionAttachments.listBySession(project.projectId, session.sessionId)).toHaveLength(1);
    expect(uow.sessionAttachments.current(project.projectId, session.sessionId)?.attachedAt).toBe(T0);
    expect(uow.sessions.get(project.projectId, session.sessionId)?.taskId).toBe(task.taskId);
    const associationEvents = uow.events
      .listByProject(project.projectId, { limit: 10 })
      .items.filter((e) => e.eventType === "session_attachment");
    expect(associationEvents).toHaveLength(0);
  });

  it("attaches with compare-and-swap and appends the attachment history", async () => {
    const project = makeProject();
    const task1 = makeTask(project.projectId, { status: "active" });
    const task2 = makeTask(project.projectId, { status: "active" });
    const session = makeSession({ taskId: task1.taskId });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task1);
      u.tasks.insert(task2);
      u.sessions.insert(project.projectId, session);
      u.sessionAttachments.insert({
        attachmentId: generateId(),
        sessionId: session.sessionId,
        projectId: project.projectId,
        taskId: task1.taskId,
        attachedAt: T0,
      });
    });
    const sessions = createHostSessionService(db);

    await sessions.attach(project.projectId, session.sessionId, task2.taskId, {
      expectedTaskId: task1.taskId,
      reason: "work moved to the second task",
      occurredAt: T1,
    });
    const uow = createUnitOfWork(db);
    expect(uow.sessions.get(project.projectId, session.sessionId)?.taskId).toBe(task2.taskId);
    const history = uow.sessionAttachments.listBySession(project.projectId, session.sessionId);
    expect(history).toHaveLength(2);
    expect(history[0]?.detachedAt).toBe(T1);
    expect(history[0]?.reason).toBe("work moved to the second task");
    expect(uow.sessionAttachments.current(project.projectId, session.sessionId)?.taskId).toBe(task2.taskId);

    // A stale expected task id fails the CAS without touching state.
    await expectSestinaCodeAsync(
      () =>
        sessions.attach(project.projectId, session.sessionId, task1.taskId, {
          expectedTaskId: task1.taskId,
        }),
      "stale_state",
    );
    expect(uow.sessions.get(project.projectId, session.sessionId)?.taskId).toBe(task2.taskId);

    // The association events were appended for each relationship change.
    const events = uow.events
      .listByProject(project.projectId, { limit: 10 })
      .items.filter((e) => e.eventType === "session_attachment");
    expect(events).toHaveLength(1);
  });

  it("detaches a session and refuses to detach an unattached one", async () => {
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    const session = makeSession({ taskId: task.taskId });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(project.projectId, session);
      u.sessionAttachments.insert({
        attachmentId: generateId(),
        sessionId: session.sessionId,
        projectId: project.projectId,
        taskId: task.taskId,
        attachedAt: T0,
      });
    });
    const sessions = createHostSessionService(db);

    await sessions.detach(project.projectId, session.sessionId, { reason: "session ended" });
    const uow = createUnitOfWork(db);
    expect(uow.sessions.get(project.projectId, session.sessionId)?.taskId).toBeUndefined();
    expect(uow.sessionAttachments.current(project.projectId, session.sessionId)).toBeUndefined();

    await expectSestinaCodeAsync(
      () => sessions.detach(project.projectId, session.sessionId),
      "validation_failed",
    );
  });

  it("previews the attach consequences: contract switch, incomplete items, open reviews", async () => {
    const project = makeProject();
    const contract1 = makeContract();
    const contract2 = makeContract();
    const task1 = makeTask(project.projectId, {
      status: "active",
      taskId: contract1.taskId,
      contractId: contract1.contractId,
    });
    const task2 = makeTask(project.projectId, {
      status: "active",
      taskId: contract2.taskId,
      contractId: contract2.contractId,
    });
    const session = makeSession({ taskId: task1.taskId });
    const openReview = {
      reviewId: generateId(),
      projectId: project.projectId,
      taskId: task2.taskId,
      trigger: "user_decision_required",
      title: "open review on the target task",
      description: "needs a human",
      requiredDecision: "continue or stop",
      availableActions: ["continue", "stop"],
      contextRefs: [],
      status: "open",
      priority: 2,
      openedAt: T0,
      version: 1,
    } as const;
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task1);
      u.tasks.insert(task2);
      u.contracts.insert(project.projectId, contract1);
      u.contracts.insert(project.projectId, contract2);
      u.sessions.insert(project.projectId, session);
      u.reviews.insertItem({ ...openReview });
    });
    const sessions = createHostSessionService(db);
    const preview = await sessions.previewAttach(project.projectId, session.sessionId, task2.taskId);
    expect(preview.currentTaskId).toBe(task1.taskId);
    expect(preview.targetTaskId).toBe(task2.taskId);
    expect(preview.contractChange).toBe(true);
    expect(preview.incompleteDeliverables).toBe(contract2.deliverables.length);
    expect(preview.openReviews.map((r) => r.reviewId)).toEqual([openReview.reviewId]);
    expect(preview.pendingDecisions).toEqual([]);
  });
});
