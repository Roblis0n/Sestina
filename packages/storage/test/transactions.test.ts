import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  openDatabase,
  withTransaction,
  validateJson,
  type StorageDatabase,
} from "../src/index.js";
import { isSestinaError, SestinaErrorCode, CollaborationMessageSchema } from "@sestina/schema";
import { makeTempDir, removeTempDir, loadStorageFixture, createThread, createEndpoint, createClaudeEndpoint } from "./helpers.js";

describe("withTransaction (docs/22 Task 5 Step 1)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("opens a defensive WAL database and rolls back the whole unit", async () => {
    expect(db.pragma("journal_mode")).toBe("wal");
    expect(db.pragma("foreign_keys")).toBe(1);

    await expect(
      withTransaction(db, (tx) => {
        tx.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','k1','p','t','stop',1,1,'internal','{}')");
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(db.get("SELECT event_id FROM events WHERE event_id = 'e1'")).toBeUndefined();
    expect(db.isTransaction).toBe(false);
  });

  it("returns the unit's result and commits it", async () => {
    const result = await withTransaction(db, (tx) => {
      tx.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e2','k2','p','t','stop',1,1,'internal','{}')");
      return "unit-done";
    });
    expect(result).toBe("unit-done");
    expect(db.get("SELECT event_id FROM events WHERE event_id = 'e2'")).toBeTruthy();
  });

  it("rolls back an inner unit via savepoints without losing the outer unit", async () => {
    await withTransaction(db, async (tx) => {
      tx.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e3','k3','p','t','stop',1,1,'internal','{}')");
      await expect(
        withTransaction(db, (inner) => {
          inner.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e4','k4','p','t','stop',1,1,'internal','{}')");
          throw new Error("inner abort");
        }),
      ).rejects.toThrow("inner abort");
    });
    expect(db.get("SELECT event_id FROM events WHERE event_id = 'e3'")).toBeTruthy();
    expect(db.get("SELECT event_id FROM events WHERE event_id = 'e4'")).toBeUndefined();
  });

  it("commits a collaboration message, its initial attempt and the event in one unit", async () => {
    const thread = loadStorageFixture("valid-collaboration-thread.json");
    const message = loadStorageFixture("valid-collaboration-message.json");
    createThread(db, thread);
    createEndpoint(db, loadStorageFixture("valid-collaboration-endpoint.json"));
    createClaudeEndpoint(db);
    const threadId = (thread as { threadId: string }).threadId;
    const projectId = (thread as { projectId: string }).projectId;
    const taskId = (thread as { taskId: string }).taskId;
    const target = (thread as { participantEndpointIds: string[] }).participantEndpointIds[1] ?? "";
    const messageId = (message as { messageId: string }).messageId;
    const dedupeKey = (message as { dedupeKey: string }).dedupeKey;

    await withTransaction(db, (tx) => {
      tx.run(
        "INSERT INTO collaboration_messages (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, body, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data) VALUES (?, ?, ?, ?, 'consult', ?, ?, ?, 'internal', ?, ?, ?, ?, ?, ?)",
        messageId,
        threadId,
        projectId,
        taskId,
        (message as { sourceEndpointId: string }).sourceEndpointId,
        (message as { summary: string }).summary,
        (message as { body?: string }).body ?? null,
        (message as { ttlSeconds: number }).ttlSeconds,
        (message as { hopCount: number }).hopCount,
        dedupeKey,
        Date.now(),
        Date.now() + 1000,
        JSON.stringify(message),
      );
      tx.run(
        "INSERT INTO collaboration_delivery_attempts (attempt_id, message_id, target_endpoint_id, sequence, route, status, started_at, data) VALUES (?, ?, ?, 1, 'mcp-inbox', 'queued', ?, '{}')",
        "01JGNRBZ7TNHVPC3DF6R8BACMM",
        messageId,
        target,
        Date.now(),
      );
      tx.run(
        "INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES (?, ?, ?, ?, 'collaboration_message', ?, ?, 'internal', ?)",
        "01JGNK8W4QKERM9VA0C3N5Y7ZE",
        `collab-${messageId}`,
        projectId,
        taskId,
        Date.now(),
        Date.now(),
        JSON.stringify(message),
      );
    });

    expect(db.get("SELECT message_id FROM collaboration_messages WHERE message_id = ?", messageId)).toBeTruthy();
    expect(db.get("SELECT attempt_id FROM collaboration_delivery_attempts WHERE message_id = ?", messageId)).toBeTruthy();
    expect(db.get("SELECT event_id FROM events WHERE idempotency_key = ?", `collab-${messageId}`)).toBeTruthy();
  });

  it("persists nothing deliverable when the message unit fails (no message, no attempt)", async () => {
    const thread = loadStorageFixture("valid-collaboration-thread.json");
    const message = loadStorageFixture("valid-collaboration-message.json");
    createThread(db, thread);
    const threadId = (thread as { threadId: string }).threadId;
    const projectId = (thread as { projectId: string }).projectId;
    const taskId = (thread as { taskId: string }).taskId;
    const messageId = (message as { messageId: string }).messageId;

    await expect(
      withTransaction(db, (tx) => {
        tx.run(
          "INSERT INTO collaboration_messages (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data) VALUES (?, ?, ?, ?, 'status', ?, 's', 'internal', 1, 0, 'dk-fail', 1, 2, '{}')",
          messageId,
          threadId,
          projectId,
          taskId,
          (message as { sourceEndpointId: string }).sourceEndpointId,
        );
        throw new Error("delivery rejected before persist");
      }),
    ).rejects.toThrow("delivery rejected before persist");

    // Nothing was persisted, so there is nothing a router could forward.
    expect(db.get("SELECT message_id FROM collaboration_messages WHERE message_id = ?", messageId)).toBeUndefined();
    expect(db.get("SELECT attempt_id FROM collaboration_delivery_attempts WHERE message_id = ?", messageId)).toBeUndefined();
  });
});

describe("No write transaction during host/provider calls (docs/17 §3.2, docs/22 Task 5)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("rolls back when COMMIT fails on an async unit and keeps the connection usable", async () => {
    // defer_foreign_keys defers the FK check to COMMIT, so the commit
    // itself fails — the wrapper must not leave a half-open transaction.
    db.exec("PRAGMA defer_foreign_keys = ON");
    try {
      await expect(
        withTransaction(db, async (tx) => {
          tx.run(
            "INSERT INTO collaboration_messages (message_id, thread_id, project_id, task_id, kind, source_endpoint_id, summary, privacy_class, ttl_seconds, hop_count, dedupe_key, created_at, expires_at, data) VALUES ('orphan','missing-thread','p','t','status','e','s','internal',1,0,'dk-orphan',1,2,'{}')",
          );
          await Promise.resolve();
        }),
      ).rejects.toSatisfy((err: unknown) => isSestinaError(err));
    } finally {
      db.exec("PRAGMA defer_foreign_keys = OFF");
    }

    expect(db.isTransaction).toBe(false);
    expect(db.get("SELECT message_id FROM collaboration_messages WHERE message_id = 'orphan'")).toBeUndefined();
    // The connection stays usable after the failed commit.
    db.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('post1','pk-post1','p','t','stop',1,1,'internal','{}')");
    expect(db.get("SELECT event_id FROM events WHERE event_id = 'post1'")).toBeTruthy();
  });

  it("writes pending state, commits, calls the host, then completes conditionally", async () => {
    // Pattern required by the invariant: pending write -> COMMIT -> host call ->
    // conditional completion update. The host call must observe no open
    // write transaction.
    await withTransaction(db, (tx) => {
      tx.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('p1','pk1','p','t','pre_tool',1,1,'internal','{}')");
    });
    expect(db.isTransaction).toBe(false);

    let sawTransaction = false;
    const simulateHostCall = async (): Promise<string> => {
      sawTransaction = db.isTransaction; // must be false during IPC
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "host-ok";
    };
    const receipt = await simulateHostCall();

    expect(sawTransaction).toBe(false);
    expect(db.isTransaction).toBe(false);

    await withTransaction(db, (tx) => {
      if (receipt === "host-ok") {
        tx.run("UPDATE events SET privacy_class = 'public' WHERE event_id = 'p1'");
      }
    });
    expect(db.get("SELECT privacy_class FROM events WHERE event_id = 'p1'")?.privacy_class).toBe("public");
  });
});

describe("validateJson (docs/09 §21: JSON enters storage only after schema validation)", () => {
  it("accepts a schema-valid collaboration message", () => {
    const fixture = loadStorageFixture("valid-collaboration-message.json");
    const json = validateJson(CollaborationMessageSchema, fixture, "collaboration message");
    expect(JSON.parse(json)).toEqual(fixture);
  });

  it("rejects a schema-invalid collaboration message", () => {
    const fixture = loadStorageFixture("invalid-collaboration-message.json");
    try {
      validateJson(CollaborationMessageSchema, fixture, "collaboration message");
      expect.unreachable("invalid message must be rejected before storage");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.validation_failed);
      }
    }
  });
});
