import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { openDatabase, createUnitOfWork, type StorageDatabase } from "@sestina/storage";
import { createTaskService } from "../src/index.js";
import {
  makeTempDir,
  removeTempDir,
  makeDb,
  makeProject,
  makeTask,
  makeContract,
  seed,
  expectSestinaCode,
} from "./helpers.js";

describe("task lifecycle state machine (docs/30 §6)", () => {
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

  it("creates tasks as drafts and walks the allowed transitions", () => {
    const tasks = createTaskService(db);
    const project = makeProject();
    seed(db, (u) => {
      u.projects.insert(project);
    });

    const task = tasks.createTask(project.projectId, { title: "walk the path" });
    expect(task.status).toBe("draft");

    tasks.transition(project.projectId, { taskId: task.taskId, to: "active" });
    tasks.transition(project.projectId, { taskId: task.taskId, to: "blocked" });
    tasks.transition(project.projectId, { taskId: task.taskId, to: "active" });
    const completed = tasks.transition(project.projectId, { taskId: task.taskId, to: "completed" });
    expect(completed.status).toBe("completed");
    expect(tasks.getTask(project.projectId, task.taskId)?.status).toBe("completed");
  });

  it("rejects transitions outside the allowed matrix", () => {
    const tasks = createTaskService(db);
    const project = makeProject();
    const draft = makeTask(project.projectId, { status: "draft" });
    const active = makeTask(project.projectId, { status: "active" });
    const cancelled = makeTask(project.projectId, { status: "cancelled" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(draft);
      u.tasks.insert(active);
      u.tasks.insert(cancelled);
    });

    // draft cannot go straight to blocked; active can never become draft.
    expectSestinaCode(
      () => tasks.transition(project.projectId, { taskId: draft.taskId, to: "blocked" }),
      "validation_failed",
    );
    expectSestinaCode(
      () => tasks.transition(project.projectId, { taskId: active.taskId, to: "draft" }),
      "validation_failed",
    );
    // No-op transitions are rejected, not silently accepted.
    expectSestinaCode(
      () => tasks.transition(project.projectId, { taskId: draft.taskId, to: "draft" }),
      "validation_failed",
    );
    // completed/cancelled are terminal except reopen-to-active.
    expectSestinaCode(
      () => tasks.transition(project.projectId, { taskId: cancelled.taskId, to: "archived" }),
      "validation_failed",
    );
  });

  it("enforces compare-and-swap on expected status", () => {
    const tasks = createTaskService(db);
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
    });
    expectSestinaCode(
      () =>
        tasks.transition(project.projectId, {
          taskId: task.taskId,
          to: "completed",
          expectedStatus: "draft",
        }),
      "stale_state",
    );
    expect(tasks.getTask(project.projectId, task.taskId)?.status).toBe("active");
  });

  it("reopens a completed task with a new contract version and records the reason", () => {
    const tasks = createTaskService(db);
    const project = makeProject();
    const contract = makeContract({ status: "completed", version: 1 });
    const task = makeTask(project.projectId, {
      status: "completed",
      taskId: contract.taskId,
      contractId: contract.contractId,
    });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.contracts.insert(contract);
    });

    const reopened = tasks.transition(project.projectId, {
      taskId: task.taskId,
      to: "active",
      reason: "scope changed after acceptance review",
    });
    expect(reopened.status).toBe("active");

    const uow = createUnitOfWork(db);
    const versions = uow.contracts.listVersions(project.projectId, contract.contractId);
    // The new version exists and the original completed history is intact.
    expect(versions).toHaveLength(2);
    expect(versions[0]?.status).toBe("completed");
    expect(versions[1]?.status).toBe("active");
    expect(versions[1]?.version).toBe(2);
    expect(
      uow.contracts.getRevisionReason(project.projectId, contract.contractId, 2),
    ).toBe("scope changed after acceptance review");
    expect(
      uow.contracts.getRevisionReason(project.projectId, contract.contractId, 1),
    ).toBeUndefined();
  });

  it("rejects reopening a completed task without a contract", () => {
    const tasks = createTaskService(db);
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "completed" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
    });
    expectSestinaCode(
      () =>
        tasks.transition(project.projectId, {
          taskId: task.taskId,
          to: "active",
          reason: "no contract to reopen",
        }),
      "validation_failed",
    );
    expect(tasks.getTask(project.projectId, task.taskId)?.status).toBe("completed");
  });

  it("restores an archived task without inventing contract versions", () => {
    const tasks = createTaskService(db);
    const project = makeProject();
    const contract = makeContract();
    const task = makeTask(project.projectId, { status: "archived", taskId: contract.taskId });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.contracts.insert(contract);
    });
    const restored = tasks.transition(project.projectId, { taskId: task.taskId, to: "active" });
    expect(restored.status).toBe("active");
    const uow = createUnitOfWork(db);
    expect(uow.contracts.listVersions(project.projectId, contract.contractId)).toHaveLength(1);
  });

  it("browses a read-only database but refuses transitions", async () => {
    const project = makeProject();
    const task = makeTask(project.projectId, { status: "active" });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
    });
    const path = join(dir, "sestina.db");
    db.close();

    const readOnly = await openDatabase({ path, readOnly: true });
    try {
      const readOnlyTasks = createTaskService(readOnly);
      expect(readOnlyTasks.getTask(project.projectId, task.taskId)?.title).toBe(task.title);
      expect(readOnlyTasks.listTasks(project.projectId, { limit: 10 }).items).toHaveLength(1);
      expectSestinaCode(
        () =>
          readOnlyTasks.transition(project.projectId, {
            taskId: task.taskId,
            to: "completed",
          }),
        "database_readonly",
      );
      // The refused transition left no partial state behind.
      expect(readOnlyTasks.getTask(project.projectId, task.taskId)?.status).toBe("active");
    } finally {
      readOnly.close();
      db = await makeDb(dir);
    }
  });
});
