import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateId } from "@sestina/schema";
import type { StorageDatabase } from "@sestina/storage";
import {
  createHostSessionService,
  createProjectService,
  createTaskService,
  searchInProject,
} from "../src/index.js";
import {
  makeTempDir,
  removeTempDir,
  makeDb,
  makeProject,
  makeTask,
  makeSession,
  seed,
  expectSestinaCode,
  expectSestinaCodeAsync,
  T0,
} from "./helpers.js";

describe("project isolation (docs/22 Task 8 Step 3)", () => {
  let dir: string;
  let db: StorageDatabase;
  let projectA: ReturnType<typeof makeProject>;
  let projectB: ReturnType<typeof makeProject>;
  let taskA: ReturnType<typeof makeTask>;
  let taskB: ReturnType<typeof makeTask>;
  let sessionA: ReturnType<typeof makeSession>;
  let conversationA: { conversationId: string };

  beforeEach(async () => {
    dir = makeTempDir();
    db = await makeDb(dir);
    projectA = makeProject({ name: "Project A" });
    projectB = makeProject({ name: "Project B" });
    taskA = makeTask(projectA.projectId, { status: "active", title: "A-only task" });
    taskB = makeTask(projectB.projectId, { status: "active", title: "B-only task" });
    sessionA = makeSession({ taskId: taskA.taskId });
    conversationA = { conversationId: generateId() };
    seed(db, (u) => {
      u.projects.insert(projectA);
      u.projects.insert(projectB);
      u.tasks.insert(taskA);
      u.tasks.insert(taskB);
      u.sessions.insert(projectA.projectId, sessionA);
      u.conversations.insertConversation({
        conversationId: conversationA.conversationId,
        projectId: projectA.projectId,
        taskId: taskA.taskId,
        type: "governance_chat",
        title: "A conversation",
        status: "active",
        createdAt: T0,
        updatedAt: T0,
      });
      u.conversations.insertMessage({
        messageId: generateId(),
        conversationId: conversationA.conversationId,
        role: "user",
        body: "sestina-secret-alpha appears only in project A",
        contextRefs: [],
        confirmable: false,
        status: "complete",
        createdAt: T0,
      });
    });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("never leaks project A tasks or sessions through project B reads", () => {
    const tasks = createTaskService(db);
    const sessions = createHostSessionService(db);
    expect(tasks.listTasks(projectB.projectId, { limit: 10 }).items.map((t) => t.taskId)).toEqual([
      taskB.taskId,
    ]);
    expect(tasks.getTask(projectB.projectId, taskA.taskId)).toBeUndefined();
    expect(sessions.getSession(projectB.projectId, sessionA.sessionId)).toBeUndefined();
    expect(
      sessions.listByProject(projectB.projectId, { limit: 10 }).items.map((s) => s.sessionId),
    ).toEqual([]);
  });

  it("rejects cross-project writes with the same not-found codes", async () => {
    const tasks = createTaskService(db);
    const sessions = createHostSessionService(db);
    expectSestinaCode(
      () =>
        tasks.transition(projectB.projectId, {
          taskId: taskA.taskId,
          to: "completed",
        }),
      "task_not_found",
    );
    await expectSestinaCodeAsync(
      () => sessions.attach(projectB.projectId, sessionA.sessionId, taskB.taskId),
      "session_not_found",
    );
    await expectSestinaCodeAsync(
      () => sessions.attach(projectA.projectId, sessionA.sessionId, taskB.taskId),
      "task_not_found",
    );
  });

  it("scopes FTS search to the requested project", () => {
    const inA = searchInProject(db, {
      projectId: projectA.projectId,
      text: "sestina-secret-alpha",
      limit: 10,
    });
    expect(inA.length).toBeGreaterThan(0);
    const inB = searchInProject(db, {
      projectId: projectB.projectId,
      text: "sestina-secret-alpha",
      limit: 10,
    });
    expect(inB).toEqual([]);
  });

  it("pins the host session natural key to its original project on re-resolution", async () => {
    const sessions = createHostSessionService(db);
    const result = await sessions.resolveOnStart({
      host: sessionA.host,
      hostSessionId: sessionA.hostSessionId,
      projectId: projectB.projectId,
      visibilityLevel: "tool_lifecycle",
      capabilities: [],
      startedAt: T0,
    });
    // The natural (host, hostSessionId) key is authoritative: the session
    // already belongs to project A, and project B must never capture it.
    expect(result.kind).toBe("existing");
    if (result.kind !== "existing") return;
    expect(result.project.projectId).toBe(projectA.projectId);
    expect(result.hostSession.projectId).toBe(projectA.projectId);
  });

  it("keeps project-service reads and updates inside the requested project", () => {
    const projects = createProjectService(db);
    const renamed = projects.renameProject(projectB.projectId, "Project B renamed");
    expect(renamed.name).toBe("Project B renamed");
    expect(projects.getProject(projectA.projectId)?.name).toBe("Project A");
  });
});
