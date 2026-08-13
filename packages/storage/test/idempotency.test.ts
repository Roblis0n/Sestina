import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { generateId, isSestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StandardEvent, Decision, CollaborationThread, CollaborationMessage, CollaborationEndpoint } from "@sestina/schema";
import { openDatabase, createUnitOfWork } from "../src/index.js";
import { makeTempDir, removeTempDir, loadStorageFixture } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

function makeEvent(projectId: string, taskId: string, idempotencyKey: string): StandardEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: generateId(),
    idempotencyKey,
    eventType: "pre_tool",
    host: "codex",
    projectId,
    taskId,
    sessionId: generateId(),
    occurredAt: "2026-08-13T00:00:00.000Z",
    receivedAt: "2026-08-13T00:00:00.050Z",
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: "b".repeat(64),
  };
}

function makeDecision(event: StandardEvent): Decision {
  return {
    decisionId: generateId(),
    eventId: event.eventId,
    taskId: event.taskId,
    category: "allow",
    riskLevel: 0,
    reasonCode: "default_continue",
    reason: "No boundary hit",
    boundaryIds: [],
    ruleFindingIds: [],
    recoverySteps: [],
    userDecisionNeeded: false,
    overridable: false,
    judge: { status: "not_needed" },
    contractVersion: 1,
    createdAt: "2026-08-13T00:00:00.200Z",
  };
}

describe("Event idempotency (docs/22 Task 6 Step 1)", () => {
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

  it("returns the original decision for a duplicate event without a second lease", async () => {
    const uow = createUnitOfWork(db);
    const projectId = generateId();
    const taskId = generateId();
    const event = makeEvent(projectId, taskId, "stable-idempotency-key");
    const decision = makeDecision(event);

    await uow.commit((u) => {
      u.projects.insert({
        projectId, name: "p", bindings: [], status: "active",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      u.tasks.insert({
        taskId, projectId, title: "t", status: "active", priority: "normal",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      const first = u.events.reserve(event, { ownerId: "owner-a" });
      expect(first.kind).toBe("created");
      if (first.kind === "created") {
        u.decisions.complete({ lease: first.lease, decision });
      }
    });

    const leaseCountBefore = db.get<{ c: number | bigint }>(
      "SELECT COUNT(*) AS c FROM event_leases WHERE idempotency_key = 'stable-idempotency-key'",
    );
    expect(Number(leaseCountBefore?.c ?? 0)).toBe(1);

    // Duplicate: new event id, same idempotency key.
    const duplicate = await uow.commit((u) =>
      u.events.reserve({ ...event, eventId: generateId() }, { ownerId: "owner-b" }),
    );
    expect(duplicate).toEqual({ kind: "completed", decisionId: decision.decisionId });

    const leaseCountAfter = db.get<{ c: number | bigint }>(
      "SELECT COUNT(*) AS c FROM event_leases WHERE idempotency_key = 'stable-idempotency-key'",
    );
    expect(Number(leaseCountAfter?.c ?? 0)).toBe(1);
    const eventCount = db.get<{ c: number | bigint }>(
      "SELECT COUNT(*) AS c FROM events WHERE idempotency_key = 'stable-idempotency-key'",
    );
    expect(Number(eventCount?.c ?? 0)).toBe(1);
  });

  it("rejects completing a lease with the wrong owner", async () => {
    const uow = createUnitOfWork(db);
    const projectId = generateId();
    const taskId = generateId();
    const event = makeEvent(projectId, taskId, "owner-check-key");
    const decision = makeDecision(event);

    await uow.commit((u) => {
      u.projects.insert({
        projectId, name: "p", bindings: [], status: "active",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      u.tasks.insert({
        taskId, projectId, title: "t", status: "active", priority: "normal",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      u.events.reserve(event, { ownerId: "owner-a" });
    });

    await expect(
      uow.commit((u) => {
        u.decisions.complete({
          lease: { idempotencyKey: "owner-check-key", ownerId: "impostor", expiresAt: Date.now() + 30_000 },
          decision,
        });
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.stale_state;
    });
  });
});

describe("Collaboration idempotency (message/target, dedupe key, expiry)", () => {
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

  async function seed(): Promise<{ message: CollaborationMessage }> {
    const uow = createUnitOfWork(db);
    const thread = loadStorageFixture("valid-collaboration-thread.json") as CollaborationThread;
    const endpoint = loadStorageFixture("valid-collaboration-endpoint.json") as CollaborationEndpoint;
    const message = {
      ...(loadStorageFixture("valid-collaboration-message.json") as CollaborationMessage),
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    await uow.commit((u) => {
      u.projects.insert({
        projectId: thread.projectId, name: "p", bindings: [], status: "active",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      u.tasks.insert({
        taskId: thread.taskId, projectId: thread.projectId, title: "t", status: "active", priority: "normal",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      u.collaboration.insertThread(thread);
      u.collaboration.insertEndpoint(endpoint);
      u.collaboration.insertEndpoint({
        ...endpoint,
        endpointId: (message.targetEndpointIds[0] as string),
        host: "claude_code" as const,
        hostSessionId: "session-claude-001",
      });
      u.collaboration.insertMessage(message);
    });
    return { message };
  }

  it("rejects a duplicate dedupe key and stores nothing", async () => {
    const { message } = await seed();
    const uow = createUnitOfWork(db);
    await expect(
      uow.commit((u) => {
        u.collaboration.insertMessage({ ...message, messageId: generateId() });
      }),
    ).rejects.toBeTruthy();
    const count = db.get<{ c: number | bigint }>(
      "SELECT COUNT(*) AS c FROM collaboration_messages WHERE dedupe_key = ?",
      message.dedupeKey,
    );
    expect(Number(count?.c ?? 0)).toBe(1);
  });

  it("keeps message/target idempotent: one active delivery owner, already_delivered after delivery", async () => {
    const { message } = await seed();
    const uow = createUnitOfWork(db);
    const target = message.targetEndpointIds[0] as string;

    const first = await uow.commit((u) =>
      u.collaboration.reserveDelivery({ messageId: message.messageId, targetEndpointId: target, ownerId: "d1" }),
    );
    expect(first).toBe("acquired");

    const second = await uow.commit((u) =>
      u.collaboration.reserveDelivery({ messageId: message.messageId, targetEndpointId: target, ownerId: "d2" }),
    );
    expect(second).toBe("wait_for_existing");

    await uow.commit((u) => {
      u.collaboration.appendAttempt({
        attemptId: generateId(),
        messageId: message.messageId,
        targetEndpointId: target,
        sequence: 1,
        route: "mcp-inbox",
        status: "delivered",
        startedAt: new Date().toISOString(),
      });
    });

    const third = await uow.commit((u) =>
      u.collaboration.reserveDelivery({ messageId: message.messageId, targetEndpointId: target, ownerId: "d3" }),
    );
    expect(third).toBe("already_delivered");
  });

  it("never re-claims an expired message", async () => {
    const { message } = await seed();
    const uow = createUnitOfWork(db);
    const target = message.targetEndpointIds[0] as string;

    db.run("UPDATE collaboration_messages SET expires_at = ? WHERE message_id = ?", Date.now() - 1, message.messageId);

    const result = await uow.commit((u) =>
      u.collaboration.reserveDelivery({ messageId: message.messageId, targetEndpointId: target, ownerId: "d1" }),
    );
    expect(result).toBe("expired");
    // And no lease row was created.
    const lease = db.get("SELECT message_id FROM collaboration_delivery_leases WHERE message_id = ?", message.messageId);
    expect(lease).toBeUndefined();
  });

  it("rejects new attempts on an expired message", async () => {
    const { message } = await seed();
    const uow = createUnitOfWork(db);
    const target = message.targetEndpointIds[0] as string;
    db.run("UPDATE collaboration_messages SET expires_at = ? WHERE message_id = ?", Date.now() - 1, message.messageId);

    await expect(
      uow.commit((u) => {
        u.collaboration.appendAttempt({
          attemptId: generateId(),
          messageId: message.messageId,
          targetEndpointId: target,
          sequence: 1,
          route: "mcp-inbox",
          status: "queued",
          startedAt: new Date().toISOString(),
        });
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.stale_state;
    });
  });
});
