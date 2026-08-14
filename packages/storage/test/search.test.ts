import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { generateId } from "@sestina/schema";
import type { Conversation, ConversationMessage, CollaborationThread, CollaborationMessage } from "@sestina/schema";
import { openDatabase, createUnitOfWork, search } from "../src/index.js";
import { makeTempDir, removeTempDir, loadStorageFixture } from "./helpers.js";
import { seedCollaboration } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

describe("Project-scoped FTS search (docs/22 Task 6)", () => {
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
    const base = {
      bindings: [],
      status: "active" as const,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    uow.commit((u) => {
      for (const [projectId, taskId] of [[projectA, taskA], [projectB, taskB]] as const) {
        u.projects.insert({ projectId, name: "p", ...base });
        u.tasks.insert({
          taskId, projectId, title: "t", status: "active", priority: "normal",
          createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
        });
      }
      // Same phrase in both projects.
      for (const [projectId] of [[projectA], [projectB]] as const) {
        const conversation: Conversation = {
          conversationId: generateId(), projectId, type: "governance_chat", title: "c",
          status: "active", createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
        };
        u.conversations.insertConversation(conversation);
        const message: ConversationMessage = {
          messageId: generateId(), conversationId: conversation.conversationId, role: "sestina",
          body: `project-needle-${projectId}`, contextRefs: [], confirmable: false,
          status: "complete", createdAt: "2026-08-13T00:00:01.000Z",
        };
        u.conversations.insertMessage(message);
      }
    });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("never returns project B content in project A search", () => {
    const rows = search(db, { projectId: projectA, text: "needle", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.projectId).toBe(projectA);
      expect(row.snippet).toContain(projectA);
      expect(row.snippet).not.toContain(projectB);
    }
    const rowsB = search(db, { projectId: projectB, text: "needle", limit: 50 });
    for (const row of rowsB) {
      expect(row.projectId).toBe(projectB);
    }
  });

  it("rejects invalid project ids and empty queries", () => {
    expect(() => search(db, { projectId: "not-a-ulid", text: "needle", limit: 10 })).toThrow();
    try {
      search(db, { projectId: projectA, text: "needle", limit: 10 });
    } catch {
      expect.unreachable("valid query must not throw");
    }
    expect(() => search(db, { projectId: projectA, text: "   ", limit: 10 })).toThrow();
  });

  it("leaves zero FTS residue after the source row is deleted", () => {
    const rows = search(db, { projectId: projectA, text: "needle", limit: 50 });
    const before = rows.length;
    expect(before).toBeGreaterThan(0);

    const conversationRows = db.all<{ message_id: string; conversation_id: string }>(
      `SELECT m.message_id, m.conversation_id FROM conversation_messages m
       JOIN conversations c ON c.conversation_id = m.conversation_id
       WHERE c.project_id = ?`,
      projectA,
    );
    const uow = createUnitOfWork(db);
    uow.commit(() => {
      for (const row of conversationRows) {
        db.run("DELETE FROM conversation_messages WHERE message_id = ?", row.message_id);
      }
    });
    const after = search(db, { projectId: projectA, text: "needle", limit: 50 });
    expect(after).toHaveLength(0);
  });

  it("matches the FTS index in the query plan (no table scan of data)", () => {
    const plan = db.all<{ id: number; parent: number; notused: number; detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT m.message_id FROM fts_conversation_messages
       JOIN conversation_messages m ON m.rowid = fts_conversation_messages.rowid
       JOIN conversations c ON c.conversation_id = m.conversation_id
       WHERE fts_conversation_messages MATCH 'needle' AND c.project_id = ? LIMIT 50`,
      projectA,
    );
    const details = plan.map((r) => r.detail).join(" | ");
    expect(details).toContain("VIRTUAL TABLE INDEX");
    expect(details).toContain("USING INDEX");
    expect(details).not.toMatch(/SCAN\s+conversation_messages/);
    expect(details).not.toMatch(/SCAN\s+conversations/);
  });
});

describe("Collaboration FTS search (docs/42 §12)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    const uow = createUnitOfWork(db);
    const seeded = seedCollaboration(db);
    const message = seeded.message as CollaborationMessage;
    uow.commit((u) => {
      // thread/endpoints/evidence are seeded by seedCollaboration.
      u.collaboration.insertMessage(message);
    });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("finds collaboration messages by summary and stays project-scoped", () => {
    const thread = loadStorageFixture("valid-collaboration-thread.json") as CollaborationThread;
    const rows = search(db, { projectId: thread.projectId, text: "storage", kinds: ["collaboration"], limit: 10 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.kind).toBe("collaboration");
      expect(row.projectId).toBe(thread.projectId);
    }
  });
});
