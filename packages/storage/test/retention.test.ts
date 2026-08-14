import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { generateId, isSestinaError, SestinaErrorCode } from "@sestina/schema";
import type { Conversation, ConversationMessage, CollaborationThread, CollaborationMessage, DecisionTrace } from "@sestina/schema";
import {
  openDatabase,
  createUnitOfWork,
  previewRetention,
  applyRetentionPreview,
  exportProject,
  withTransaction,
  MaintenanceGuard,
  search,
  createTombstoneRepository,
  createTransactionView,
} from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";
import { seedCollaboration } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MEMBER_INLINE_LIMIT = 5000;

describe("Retention preview and apply (docs/22 Task 6)", () => {
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

  function retentionConfig(): {
    captureRetentionDays: number;
    privacyRetentionDays: number;
    collaborationMessageRetentionDays: number;
  } {
    return {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    };
  }

  function applyPreview(preview: { previewId: string }): ReturnType<typeof applyRetentionPreview> {
    return applyRetentionPreview(db, {
      previewId: preview.previewId,
      databasePath: join(dir, "sestina.db"),
      busyTimeoutMs: 400,
    });
  }

  function seedOldContent(projectId: string, taskId: string, nowMs: number): {
    conversationId: string;
    messageId: string;
  } {
    const uow = createUnitOfWork(db);
    const oldIso = new Date(nowMs - 120 * DAY_MS).toISOString();
    const conversationId = generateId();
    const messageId = generateId();
    uow.commit((u) => {
      u.projects.insert({
        projectId, name: "p", bindings: [], status: "active",
        createdAt: oldIso, updatedAt: oldIso,
      });
      u.tasks.insert({
        taskId, projectId, title: "t", status: "active", priority: "normal",
        createdAt: oldIso, updatedAt: oldIso,
      });
      const conversation: Conversation = {
        conversationId, projectId, type: "governance_chat", title: "c",
        status: "active", createdAt: oldIso, updatedAt: oldIso,
      };
      u.conversations.insertConversation(conversation);
      u.conversations.insertMessage({
        messageId, conversationId, role: "sestina",
        body: "sensitive-conversation-secret", contextRefs: [], confirmable: false,
        status: "complete", createdAt: oldIso,
      } satisfies ConversationMessage);
    });
    return { conversationId, messageId };
  }

  function insertOldMessage(conversationId: string, nowMs: number): string {
    const messageId = generateId();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.conversations.insertMessage({
        messageId, conversationId, role: "sestina",
        body: `late-inserted-secret-${messageId}`, contextRefs: [], confirmable: false,
        status: "complete", createdAt: new Date(nowMs - 120 * DAY_MS).toISOString(),
      } satisfies ConversationMessage);
    });
    return messageId;
  }

  it("fixes objects, tables, time ranges, estimates, member summaries and a preview hash", () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    expect(preview.previewId.length).toBeGreaterThan(0);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.targets.map((t) => t.object)).toEqual([
      "host_stream_events",
      "conversation_bodies",
      "collaboration_bodies",
      "decision_traces",
      "expired_evidence_excerpts",
      "expired_exports",
    ]);
    expect(preview.targets.every((t) => t.table.length > 0)).toBe(true);
    expect(preview.targets[0]?.deleteRows).toBe(true);
    expect(preview.targets[1]?.deleteRows).toBe(false);
    expect(preview.targets[1]?.columns).toEqual(["body"]);
    expect(preview.targets[1]?.estimatedCount).toBe(1);
    const bodies = preview.targets[1];
    expect(bodies?.members.kind).toBe("ids");
    if (bodies?.members.kind === "ids") {
      expect(bodies.members.ids).toHaveLength(1);
    }
    // The preview is persisted: apply can work from the database alone.
    const row = db.get("SELECT preview_id FROM retention_previews WHERE preview_id = ?", preview.previewId);
    expect(row).toBeDefined();
  });

  it("rejects an apply whose stored preview no longer matches its hash", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    // Tamper with the persisted targets: the stored hash no longer matches.
    db.run("UPDATE retention_previews SET targets_json = '[]' WHERE preview_id = ?", preview.previewId);
    await expect(applyPreview(preview)).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.preview_changed;
    });
    // An unknown preview id is a validation failure, never a silent no-op.
    await expect(
      applyRetentionPreview(db, { previewId: "missing-preview", databasePath: join(dir, "sestina.db") }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.validation_failed;
    });
  });

  it("detects rows inserted after the preview was taken", async () => {
    const projectId = generateId();
    const taskId = generateId();
    const seeded = seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    // An old message inserted AFTER the snapshot invalidates it.
    insertOldMessage(seeded.conversationId, Date.now());
    await expect(applyPreview(preview)).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.preview_changed;
    });
  });

  it("detects member substitution with the same member count", async () => {
    const projectId = generateId();
    const taskId = generateId();
    const seeded = seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    // Substitute the member with a DIFFERENT old message: the count stays
    // the same but the id set changes — the snapshot must catch it.
    db.run("DELETE FROM conversation_messages WHERE message_id = ?", seeded.messageId);
    insertOldMessage(seeded.conversationId, Date.now());
    await expect(applyPreview(preview)).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.preview_changed;
    });
  });

  it("detects field changes that move a member out of the snapshot", async () => {
    const projectId = generateId();
    const taskId = generateId();
    const seeded = seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    // A field change (created_at) changes membership without touching ids.
    db.run("UPDATE conversation_messages SET created_at = ? WHERE message_id = ?", Date.now(), seeded.messageId);
    await expect(applyPreview(preview)).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.preview_changed;
    });
  });

  it("clears bodies, syncs FTS and leaves irreversible tombstones", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const before = search(db, { projectId, text: "sensitive-conversation-secret", limit: 10 });
    expect(before).toHaveLength(1);

    const preview = previewRetention(db, retentionConfig());
    const result = await applyPreview(preview);
    expect(result.appliedTargets).toBe(6);
    expect(result.tombstoneCount).toBeGreaterThan(0);

    // FTS residue is zero and the body column is gone.
    const after = search(db, { projectId, text: "sensitive-conversation-secret", limit: 10 });
    expect(after).toHaveLength(0);
    const body = db.get<{ body: string | null }>(
      "SELECT body FROM conversation_messages WHERE body IS NOT NULL",
    );
    expect(body).toBeUndefined();
  });

  it("re-applying the same preview performs zero operations", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    const first = await applyPreview(preview);
    expect(first.appliedTargets).toBe(6);
    const second = await applyPreview(preview);
    expect(second.appliedTargets).toBe(0);
    expect(second.tombstoneCount).toBe(0);
    // True idempotency is recorded per (preview, target) pair.
    const applied = db.all<{ target_object: string }>(
      "SELECT target_object FROM retention_applied WHERE preview_id = ? ORDER BY target_object",
      preview.previewId,
    );
    expect(applied).toHaveLength(6);
  });

  it("removes decision traces and keeps only structural tombstones", async () => {
    const projectId = generateId();
    const taskId = generateId();
    const nowMs = Date.now();
    const oldIso = new Date(nowMs - 120 * DAY_MS).toISOString();
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.projects.insert({
        projectId, name: "p", bindings: [], status: "active",
        createdAt: oldIso, updatedAt: oldIso,
      });
      u.tasks.insert({
        taskId, projectId, title: "t", status: "active", priority: "normal",
        createdAt: oldIso, updatedAt: oldIso,
      });
      const event = {
        schemaVersion: "1.0.0" as const,
        eventId: generateId(),
        idempotencyKey: generateId(),
        eventType: "pre_tool" as const,
        host: "codex" as const,
        projectId,
        taskId,
        sessionId: generateId(),
        occurredAt: oldIso,
        receivedAt: oldIso,
        bypass: false,
        privacyClass: "internal" as const,
        rawPayloadHash: "e".repeat(64),
      };
      const reserved = u.events.reserve(event, { ownerId: "owner-a" });
      expect(reserved.kind).toBe("created");
      if (reserved.kind === "created") {
        const decision = {
          decisionId: generateId(), eventId: event.eventId, taskId, category: "allow" as const,
          riskLevel: 0, reasonCode: "default_continue", reason: "ok", boundaryIds: [],
          ruleFindingIds: [], recoverySteps: [], userDecisionNeeded: false, overridable: false,
          judge: { status: "not_needed" as const }, contractVersion: 1, createdAt: oldIso,
        };
        u.decisions.complete({
          lease: reserved.lease,
          decision,
          trace: {
            traceId: generateId(), decisionId: decision.decisionId, eventId: event.eventId,
            stages: [{
              stage: "received" as const, status: "completed" as const,
              startedAt: oldIso, completedAt: oldIso, limitations: [],
            }],
            totalProcessingMs: 1, visibleToUser: true, limitations: [],
          } satisfies DecisionTrace,
        });
      }
    });

    const preview = previewRetention(db, retentionConfig());
    const result = await applyPreview(preview);
    expect(result.tombstoneCount).toBeGreaterThan(0);

    expect(db.get("SELECT trace_id FROM decision_traces")).toBeUndefined();
    const tx = createTransactionView(db);
    const tombstones = createTombstoneRepository(tx);
    const list = tombstones.listByProject(projectId, { limit: 100 });
    const traceTombstone = list.items.find((t) => t.entityKind === "decision_trace");
    expect(traceTombstone).toBeDefined();
    // Nothing of the trace content survives: the summary is structural only.
    expect(traceTombstone?.summary).toBe("decision trace removed by retention");
    expect(JSON.stringify(traceTombstone)).not.toContain("received");
  });

  it("cleans collaboration bodies and keeps irreversible tombstones", async () => {
    const nowMs = Date.now();
    const oldIso = new Date(nowMs - 120 * DAY_MS).toISOString();
    const uow = createUnitOfWork(db);
    const seeded = seedCollaboration(db);
    const thread = seeded.thread as CollaborationThread;
    const message = {
      ...(seeded.message as CollaborationMessage),
      createdAt: oldIso,
      expiresAt: new Date(nowMs - 60 * DAY_MS).toISOString(),
    };
    uow.commit((u) => {
      // thread/endpoints/evidence are seeded by seedCollaboration.
      u.collaboration.insertMessage(message);
    });

    const preview = previewRetention(db, retentionConfig());
    const result = await applyPreview(preview);
    expect(result.tombstoneCount).toBeGreaterThan(0);

    const row = db.get<{ summary: string | null; body: string | null }>(
      "SELECT summary, body FROM collaboration_messages WHERE message_id = ?",
      message.messageId,
    );
    expect(row?.summary).toBe("");
    expect(row?.body).toBeNull();
    const tx = createTransactionView(db);
    const tombstones = createTombstoneRepository(tx);
    const list = tombstones.listByProject(thread.projectId, { limit: 100 });
    const tombstone = list.items.find((t) => t.entityKind === "collaboration_message");
    expect(tombstone).toBeDefined();
    expect(JSON.stringify(tombstone)).not.toContain("Is the storage concurrency test");
  });

  it("pages tombstones with keyset cursors (no dupes, real nextCursor)", async () => {
    const projectId = generateId();
    const taskId = generateId();
    const { conversationId } = seedOldContent(projectId, taskId, Date.now());
    // A second old message guarantees at least two tombstones so the
    // keyset cursor actually has to skip.
    insertOldMessage(conversationId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    await applyPreview(preview);

    const tx = createTransactionView(db);
    const tombstones = createTombstoneRepository(tx);
    const total = tombstones.listByProject(projectId, { limit: 100 }).items.length;
    const page1 = tombstones.listByProject(projectId, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBeDefined();
    const page2 = tombstones.listByProject(projectId, { cursor: page1.nextCursor, limit: 100 });
    // The keyset cursor must never hand a page-1 row back and pages must
    // partition the full set exactly.
    expect(page2.items.map((t) => t.tombstoneId)).not.toContain(page1.items[0]?.tombstoneId);
    expect(page1.items.length + page2.items.length).toBe(total);
  });

  it("refuses to apply while the maintenance fence is held", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, retentionConfig());
    const fence = await MaintenanceGuard.acquire({
      databasePath: join(dir, "sestina.db"),
      scope: "migrations",
      ownerId: "test",
      busyTimeoutMs: 400,
    });
    try {
      await expect(applyPreview(preview)).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      fence.release();
    }
  });

  it("removes host stream events by occurred_at and keeps recent ones", async () => {
    const projectId = generateId();
    const taskId = generateId();
    const nowMs = Date.now();
    seedOldContent(projectId, taskId, nowMs);
    const oldIso = new Date(nowMs - 120 * DAY_MS).toISOString();
    const recentIso = new Date(nowMs - 1 * DAY_MS).toISOString();
    db.run(
      `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
       VALUES ('hs-1', ?, ?, 'codex', 'host-session-1', 'active', ?, '{}')`,
      projectId,
      taskId,
      nowMs - 120 * DAY_MS,
    );
    db.run(
      `INSERT INTO host_stream_events (stream_event_id, session_id, sequence, kind, data)
       VALUES ('hse-old', 'hs-1', 1, 'user_message', ?)`,
      JSON.stringify({ occurredAt: oldIso }),
    );
    db.run(
      `INSERT INTO host_stream_events (stream_event_id, session_id, sequence, kind, data)
       VALUES ('hse-recent', 'hs-1', 2, 'user_message', ?)`,
      JSON.stringify({ occurredAt: recentIso }),
    );

    // The migration trigger materialized occurred_at in ms.
    expect(
      db.get<{ occurred_at: number }>("SELECT occurred_at FROM host_stream_events WHERE stream_event_id = 'hse-recent'")?.occurred_at,
    ).toBe(Date.parse(recentIso));

    const preview = previewRetention(db, retentionConfig());
    const hostStream = preview.targets[0];
    expect(hostStream?.members.kind).toBe("ids");
    if (hostStream?.members.kind === "ids") {
      expect(hostStream.members.ids).toEqual(["hse-old"]);
    }
    const result = await applyPreview(preview);
    expect(result.tombstoneCount).toBeGreaterThan(0);
    expect(db.get("SELECT stream_event_id FROM host_stream_events WHERE stream_event_id = 'hse-old'")).toBeUndefined();
    expect(db.get("SELECT stream_event_id FROM host_stream_events WHERE stream_event_id = 'hse-recent'")).toBeDefined();
  });

  it("purges expired export directories and marks the metadata", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const result = await exportProject(db, { projectId, destinationDir: dir });
    expect(existsSync(join(dir, "exports", result.exportId, "project.json"))).toBe(true);
    db.run("UPDATE export_metadata SET expires_at = ? WHERE export_id = ?", Date.now() - 1000, result.exportId);

    const preview = previewRetention(db, retentionConfig());
    const exports = preview.targets[5];
    expect(exports?.members.kind).toBe("ids");
    if (exports?.members.kind === "ids") {
      expect(exports.members.ids).toEqual([result.exportId]);
    }
    await applyPreview(preview);

    expect(existsSync(join(dir, "exports", result.exportId))).toBe(false);
    const meta = db.get<{ status: string }>("SELECT status FROM export_metadata WHERE export_id = ?", result.exportId);
    expect(meta?.status).toBe("purged");
  });

  it("fails safe on invalid export metadata and never deletes user files", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const outside = makeTempDir("sestina-retention-outside-");
    try {
      const userFile = join(outside, "user-notes.txt");
      writeFileSync(userFile, "precious-user-content", "utf8");
      db.run(
        `INSERT INTO export_metadata (export_id, project_id, task_id, kind, scope_json, output_path, content_hash, status, created_at, expires_at, data)
         VALUES ('exp-outside', ?, NULL, 'minimal', '{}', ?, 'h', 'ready', 1, ?, '{}')`,
        projectId,
        outside,
        Date.now() - 1000,
      );
      const preview = previewRetention(db, retentionConfig());
      await applyPreview(preview);
      // Fail-safe: the user directory is untouched and the row stays ready.
      expect(existsSync(userFile)).toBe(true);
      const meta = db.get<{ status: string }>("SELECT status FROM export_metadata WHERE export_id = 'exp-outside'");
      expect(meta?.status).toBe("ready");
    } finally {
      removeTempDir(outside);
    }
  });

  it("marks exports whose directory is already gone as purged", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    db.run(
      `INSERT INTO export_metadata (export_id, project_id, task_id, kind, scope_json, output_path, content_hash, status, created_at, expires_at, data)
       VALUES ('exp-gone', ?, NULL, 'minimal', '{}', ?, 'h', 'ready', 1, ?, '{}')`,
      projectId,
      join(dir, "exports", "exp-gone"),
      Date.now() - 1000,
    );
    const preview = previewRetention(db, retentionConfig());
    await applyPreview(preview);
    const meta = db.get<{ status: string }>("SELECT status FROM export_metadata WHERE export_id = 'exp-gone'");
    expect(meta?.status).toBe("purged");
  });

  it("summarises targets larger than the inline limit as count plus digest", async () => {
    const projectId = generateId();
    const taskId = generateId();
    seedOldContent(projectId, taskId, Date.now());
    const nowMs = Date.now();
    const oldMs = Date.parse(new Date(nowMs - 120 * DAY_MS).toISOString());
    withTransaction(db, (tx) => {
      for (let i = 0; i < MEMBER_INLINE_LIMIT + 1; i++) {
        tx.run(
          `INSERT INTO evidence_items (evidence_id, project_id, task_id, type, status, excerpt, content_hash, recorded_by, observed_at, expires_at, data)
           VALUES (?, ?, ?, 'primary_source', 'verified', ?, 'h', 'user', ?, ?, '{}')`,
          `ev-${i}`,
          projectId,
          taskId,
          `bulk-sensitive-${i}`,
          oldMs,
          oldMs - 30 * DAY_MS,
        );
      }
    });

    const preview = previewRetention(db, retentionConfig());
    const evidence = preview.targets[4];
    expect(evidence?.members.kind).toBe("digest");
    if (evidence?.members.kind === "digest") {
      expect(evidence.members.count).toBe(MEMBER_INLINE_LIMIT + 1);
      expect(evidence.members.digest).toMatch(/^[a-f0-9]{64}$/);
    }
    await applyPreview(preview);
    const remaining = db.get<{ c: number | bigint }>(
      "SELECT COUNT(*) AS c FROM evidence_items WHERE excerpt IS NOT NULL AND expires_at <= ?",
      Date.now(),
    );
    expect(Number(remaining?.c ?? 0)).toBe(0);
  }, 120000);
});
