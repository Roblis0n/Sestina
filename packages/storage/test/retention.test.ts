import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { generateId, isSestinaError, SestinaErrorCode } from "@sestina/schema";
import type { Conversation, ConversationMessage, CollaborationThread, CollaborationEndpoint, CollaborationMessage, DecisionTrace } from "@sestina/schema";
import {
  openDatabase,
  createUnitOfWork,
  previewRetention,
  applyRetentionPreview,
  MaintenanceFence,
  search,
  createTombstoneRepository,
  createTransactionView,
} from "../src/index.js";
import { makeTempDir, removeTempDir, loadStorageFixture } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

  async function seedOldContent(projectId: string, taskId: string, nowMs: number): Promise<void> {
    const uow = createUnitOfWork(db);
    const oldIso = new Date(nowMs - 120 * DAY_MS).toISOString();
    await uow.commit((u) => {
      u.projects.insert({
        projectId, name: "p", bindings: [], status: "active",
        createdAt: oldIso, updatedAt: oldIso,
      });
      u.tasks.insert({
        taskId, projectId, title: "t", status: "active", priority: "normal",
        createdAt: oldIso, updatedAt: oldIso,
      });
      const conversation: Conversation = {
        conversationId: generateId(), projectId, type: "governance_chat", title: "c",
        status: "active", createdAt: oldIso, updatedAt: oldIso,
      };
      u.conversations.insertConversation(conversation);
      u.conversations.insertMessage({
        messageId: generateId(), conversationId: conversation.conversationId, role: "sestina",
        body: "sensitive-conversation-secret", contextRefs: [], confirmable: false,
        status: "complete", createdAt: oldIso,
      } satisfies ConversationMessage);
    });
  }

  it("fixes objects, tables, time ranges, estimates and a preview hash", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.targets.map((t) => t.object)).toEqual([
      "host_stream_events",
      "conversation_bodies",
      "collaboration_bodies",
      "decision_traces",
      "expired_evidence_excerpts",
    ]);
    expect(preview.targets.every((t) => t.table.length > 0)).toBe(true);
    expect(preview.targets[0]?.deleteRows).toBe(true);
    expect(preview.targets[1]?.deleteRows).toBe(false);
    expect(preview.targets[1]?.columns).toEqual(["body"]);
    expect(preview.targets[1]?.estimatedCount).toBe(1);
  });

  it("rejects an apply whose preview hash changed", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    const tampered = {
      ...preview,
      targets: preview.targets.map((t, i) => (i === 0 ? { ...t, deleteRows: !t.deleteRows } : t)),
    };
    await expect(
      applyRetentionPreview(db, { preview: tampered, dataRoot: dir }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.preview_changed;
    });
  });

  it("clears bodies, syncs FTS and leaves irreversible tombstones", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedOldContent(projectId, taskId, Date.now());
    const before = search(db, { projectId, text: "sensitive-conversation-secret", limit: 10 });
    expect(before).toHaveLength(1);

    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    const result = await applyRetentionPreview(db, { preview, dataRoot: dir });
    expect(result.appliedTargets).toBe(5);
    expect(result.tombstoneCount).toBeGreaterThan(0);

    // FTS residue is zero and the body column is gone.
    const after = search(db, { projectId, text: "sensitive-conversation-secret", limit: 10 });
    expect(after).toHaveLength(0);
    const body = db.get<{ body: string | null }>(
      "SELECT body FROM conversation_messages WHERE body IS NOT NULL",
    );
    expect(body).toBeUndefined();
  });

  it("re-applying the same preview is idempotent", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    const first = await applyRetentionPreview(db, { preview, dataRoot: dir });
    const second = await applyRetentionPreview(db, { preview, dataRoot: dir });
    expect(second.tombstoneCount).toBe(0);
    expect(second.appliedTargets).toBe(first.appliedTargets);
  });

  it("removes decision traces and keeps only structural tombstones", async () => {
    const projectId = generateId();
    const taskId = generateId();
    const nowMs = Date.now();
    const oldIso = new Date(nowMs - 120 * DAY_MS).toISOString();
    const uow = createUnitOfWork(db);
    await uow.commit((u) => {
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

    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    const result = await applyRetentionPreview(db, { preview, dataRoot: dir });
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
    const thread = loadStorageFixture("valid-collaboration-thread.json") as CollaborationThread;
    const endpoint = loadStorageFixture("valid-collaboration-endpoint.json") as CollaborationEndpoint;
    const message = {
      ...(loadStorageFixture("valid-collaboration-message.json") as CollaborationMessage),
      createdAt: oldIso,
      expiresAt: new Date(nowMs - 60 * DAY_MS).toISOString(),
    };
    await uow.commit((u) => {
      u.projects.insert({
        projectId: thread.projectId, name: "p", bindings: [], status: "active",
        createdAt: oldIso, updatedAt: oldIso,
      });
      u.tasks.insert({
        taskId: thread.taskId, projectId: thread.projectId, title: "t", status: "active", priority: "normal",
        createdAt: oldIso, updatedAt: oldIso,
      });
      u.collaboration.insertThread(thread);
      u.collaboration.insertEndpoint(endpoint);
      u.collaboration.insertMessage(message);
    });

    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    const result = await applyRetentionPreview(db, { preview, dataRoot: dir });
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

  it("refuses to apply while the maintenance fence is held", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedOldContent(projectId, taskId, Date.now());
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations" });
    try {
      await expect(
        applyRetentionPreview(db, { preview, dataRoot: dir }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      fence.release();
    }
  });

  it("marks expired export metadata as purged", async () => {
    const projectId = generateId();
    const taskId = generateId();
    await seedOldContent(projectId, taskId, Date.now());
    db.run(
      `INSERT INTO export_metadata (export_id, project_id, task_id, kind, scope_json, output_path, content_hash, status, created_at, expires_at, data)
       VALUES ('exp-1', ?, NULL, 'minimal', '{}', 'x', 'h', 'ready', 1, ?, '{}')`,
      projectId,
      Date.now() - 1000,
    );
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    await applyRetentionPreview(db, { preview, dataRoot: dir });
    const row = db.get<{ status: string }>("SELECT status FROM export_metadata WHERE export_id = 'exp-1'");
    expect(row?.status).toBe("purged");
  });
});
