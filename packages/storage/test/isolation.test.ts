import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { generateId, isSestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StandardEvent } from "@sestina/schema";
import { openDatabase, createUnitOfWork, search, encodeEventCursor, decodeEventCursor } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

function makeEvent(projectId: string, taskId: string, n: number): StandardEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: generateId(),
    idempotencyKey: `iso-${n}-${generateId()}`,
    eventType: "pre_tool",
    host: "codex",
    projectId,
    taskId,
    sessionId: generateId(),
    occurredAt: "2026-08-13T00:00:00.000Z",
    receivedAt: "2026-08-13T00:00:00.050Z",
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: "d".repeat(64),
  };
}

describe("Project isolation across repositories (docs/22 Task 6 invariant)", () => {
  let dir: string;
  let db: StorageDatabase;
  const projectA = generateId();
  const projectB = generateId();
  const taskA = generateId();
  const taskB = generateId();

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    const uow = createUnitOfWork(db);
    await uow.commit((u) => {
      for (const [projectId, taskId, label] of [[projectA, taskA, "A"], [projectB, taskB, "B"]] as const) {
        u.projects.insert({
          projectId, name: `project-${label}`, bindings: [], status: "active",
          createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
        });
        u.tasks.insert({
          taskId, projectId, title: `task-${label}`, status: "active", priority: "normal",
          createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
        });
        for (let n = 0; n < 5; n++) {
          u.events.reserve(makeEvent(projectId, taskId, n), { ownerId: `owner-${label}-${n}` });
        }
        u.assertions.insert({
          assertionId: generateId(), projectId, taskId, kind: "confirmed_fact",
          statement: `assertion-${label}`, sourceRefs: [], limitations: [],
          status: "active", validFrom: "2026-08-13T00:00:00.000Z",
        });
      }
    });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("never returns project B rows from project A reads", () => {
    const uow = createUnitOfWork(db);
    const eventsA = uow.events.listByProject(projectA, { limit: 100 });
    expect(eventsA.items).toHaveLength(5);
    for (const event of eventsA.items) {
      expect(event.projectId).toBe(projectA);
    }
    const tasksA = uow.tasks.listByProject(projectA, { limit: 100 });
    expect(tasksA.items).toHaveLength(1);
    expect(tasksA.items[0]?.title).toBe("task-A");
    const assertionsA = uow.assertions.listByProject(projectA, { limit: 100 });
    expect(assertionsA.items).toHaveLength(1);
    expect(assertionsA.items[0]?.statement).toBe("assertion-A");
    const decisionsA = uow.decisions.listByProject(projectA, { limit: 100 });
    expect(decisionsA.items).toHaveLength(0);
  });

  it("rejects a cursor that belongs to another project", () => {
    const uow = createUnitOfWork(db);
    const pageA = uow.events.listByProject(projectA, { limit: 2 });
    expect(pageA.nextCursor).toBeDefined();
    const forged = encodeEventCursor(projectB, 1, generateId());
    try {
      decodeEventCursor(forged, projectA);
      expect.unreachable("cross-project cursor must throw");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.project_isolation_violation);
      }
    }
    // A cursor validly pinned to B keeps B reads inside B.
    const pageB = uow.events.listByProject(projectB, { limit: 100 });
    for (const event of pageB.items) {
      expect(event.projectId).toBe(projectB);
    }
  });

  it("never leaks cross-project FTS content", async () => {
    const uow = createUnitOfWork(db);
    const conversationA = {
      conversationId: generateId(), projectId: projectA, type: "governance_chat" as const, title: "c",
      status: "active" as const, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await uow.commit((u) => {
      u.conversations.insertConversation(conversationA);
      u.conversations.insertMessage({
        messageId: generateId(), conversationId: conversationA.conversationId, role: "sestina",
        body: "secret-isolation-phrase", contextRefs: [], confirmable: false,
        status: "complete", createdAt: "2026-08-13T00:00:01.000Z",
      });
    });
    const rowsA = search(db, { projectId: projectA, text: "secret-isolation-phrase", limit: 10 });
    expect(rowsA).toHaveLength(1);
    const rowsB = search(db, { projectId: projectB, text: "secret-isolation-phrase", limit: 10 });
    expect(rowsB).toHaveLength(0);
  });
});
