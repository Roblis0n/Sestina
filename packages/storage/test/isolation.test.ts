import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { generateId, isSestinaError, SestinaErrorCode } from "@sestina/schema";
import type {
  StandardEvent,
  Decision,
  DecisionTrace,
  TaskContract,
  CollaborationThread,
  CollaborationEndpoint,
  CollaborationMessage,
} from "@sestina/schema";
import { openDatabase, createUnitOfWork, search, encodeEventCursor, decodeEventCursor } from "../src/index.js";
import { makeTempDir, removeTempDir, loadSchemaFixture, seedCollaboration, expectSestinaCode } from "./helpers.js";
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
    uow.commit((u) => {
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

  it("never leaks cross-project FTS content", () => {
    const uow = createUnitOfWork(db);
    const conversationA = {
      conversationId: generateId(), projectId: projectA, type: "governance_chat" as const, title: "c",
      status: "active" as const, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
    };
    uow.commit((u) => {
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

describe("Id-scoped reads stay inside their project (docs/22 Task 6 invariant)", () => {
  let dir: string;
  let db: StorageDatabase;
  const projectA = generateId(); // never seeded — must resolve nothing
  const projectB = generateId();
  const taskB = generateId();

  const event = makeEvent(projectB, taskB, 0);
  const decision: Decision = {
    decisionId: generateId(),
    eventId: event.eventId,
    taskId: taskB,
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
  const traceId = generateId();
  const assertionB = generateId();
  const evidenceB = generateId();
  const notificationIdB = generateId();
  const conversationB = {
    conversationId: generateId(), projectId: projectB, type: "governance_chat" as const, title: "c-b",
    status: "active" as const, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
  };
  const messageB = {
    messageId: generateId(), conversationId: conversationB.conversationId, role: "sestina" as const,
    body: "conversation-b", contextRefs: [], confirmable: false,
    status: "complete" as const, createdAt: "2026-08-13T00:00:01.000Z",
  };
  const reviewB = {
    reviewId: generateId(), projectId: projectB, taskId: taskB, trigger: "overridable_block" as const,
    title: "review-b", description: "desc", requiredDecision: "allow or block",
    availableActions: ["accept"], contextRefs: [], status: "open" as const, priority: 2,
    openedAt: "2026-08-13T00:00:00.000Z", version: 1,
  };
  const sessionB = {
    sessionId: generateId(), taskId: taskB, host: "codex", hostSessionId: `host-b-${generateId()}`,
    visibilityLevel: "tool_lifecycle" as const, status: "connected" as const,
    capabilities: ["tool_interception"], startedAt: "2026-08-13T00:00:00.000Z",
  };
  const usageB = {
    usageId: generateId(), providerId: "openai-main", taskId: taskB, model: "gpt-5",
    callAt: "2026-08-13T00:00:00.000Z", tokensIn: 120, tokensOut: 40, cost: 0.0002,
  };
  const notificationB = {
    notificationId: notificationIdB, activityId: generateId(), deliveredAt: "2026-08-13T00:00:00.000Z",
    channel: "feed_item" as const, acknowledged: false,
  };
  const contractB = { ...(loadSchemaFixture("valid-contract.json") as TaskContract), taskId: taskB };

  // collaboration content lives in the fixture's own project; attempts and
  // actions are appended raw so both state projections have rows.
  let thread: CollaborationThread;
  let collabMessage: CollaborationMessage;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    const uow = createUnitOfWork(db);
    const base = { bindings: [], status: "active" as const, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" };
    uow.commit((u) => {
      u.projects.insert({ projectId: projectB, name: "p-b", ...base });
      u.tasks.insert({
        taskId: taskB, projectId: projectB, title: "t-b", status: "active", priority: "normal",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      const reserved = u.events.reserve(event, { ownerId: "iso-owner" });
      if (reserved.kind === "created") {
        u.decisions.complete({
          lease: reserved.lease,
          decision,
          trace: {
            ...(loadSchemaFixture("valid-decision-trace.json") as DecisionTrace),
            traceId,
            decisionId: decision.decisionId,
            eventId: event.eventId,
          },
        });
      }
      u.assertions.insert({
        assertionId: assertionB, projectId: projectB, taskId: taskB, kind: "confirmed_fact",
        statement: "assertion-b", sourceRefs: [], limitations: [],
        status: "active", validFrom: "2026-08-13T00:00:00.000Z",
      });
      u.evidence.insert({
        evidenceId: evidenceB, taskId: taskB, type: "primary_source",
        locator: { type: "path", value: "/data/b.csv" }, status: "verified",
        provenance: "test", recordedBy: "user", observedAt: "2026-08-13T00:00:00.000Z",
      });
      u.conversations.insertConversation(conversationB);
      u.conversations.insertMessage(messageB);
      u.reviews.insertItem(reviewB);
      u.reviews.appendAction({
        reviewId: reviewB.reviewId, action: "accept", reason: "ok",
        performedBy: { actor: "user", channel: "desktop", directUser: true },
        performedAt: "2026-08-13T00:01:00.000Z",
      });
      u.contracts.insert(contractB);
      u.sessions.insert(sessionB);
      u.hostStream.append({
        streamEventId: generateId(), sessionId: sessionB.sessionId, sequence: 1,
        eventType: "tool_start", content: "tool started", sourceCapability: "tool_lifecycle",
        occurredAt: "2026-08-13T00:00:00.000Z",
      });
      u.usage.insert(usageB);
      u.notifications.upsertState(notificationB);
    });
    const seeded = seedCollaboration(db);
    thread = seeded.thread as CollaborationThread;
    collabMessage = seeded.message as CollaborationMessage;
    const endpoint = seeded.endpoint as CollaborationEndpoint;
    uow.commit((u) => {
      u.collaboration.insertMessage(collabMessage);
    });
    db.run(
      "INSERT INTO collaboration_delivery_attempts (attempt_id, message_id, target_endpoint_id, sequence, route, status, started_at, data) VALUES (?, ?, ?, 1, 'mcp-inbox', 'delivered', ?, '{}')",
      generateId(), collabMessage.messageId, seeded.targetEndpointId, Date.now(),
    );
    db.run(
      "INSERT INTO collaboration_actions (action_id, message_id, endpoint_id, status, acted_at, data) VALUES (?, ?, ?, 'acknowledged', ?, '{}')",
      generateId(), collabMessage.messageId, endpoint.endpointId, Date.now(),
    );
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("resolves nothing under a foreign project for every id-scoped read", () => {
    const uow = createUnitOfWork(db);
    expect(uow.tasks.get(projectA, taskB)).toBeUndefined();
    expect(uow.events.get(projectA, event.eventId)).toBeUndefined();
    expect(uow.decisions.get(projectA, decision.decisionId)).toBeUndefined();
    expect(uow.traces.get(projectA, traceId)).toBeUndefined();
    expect(uow.traces.listByDecision(projectA, decision.decisionId)).toHaveLength(0);
    expect(uow.decisions.listByTask(projectA, taskB, { limit: 10 }).items).toHaveLength(0);
    expect(uow.assertions.get(projectA, assertionB)).toBeUndefined();
    expect(uow.assertions.listByTask(projectA, taskB, { limit: 10 }).items).toHaveLength(0);
    expect(uow.evidence.get(projectA, evidenceB)).toBeUndefined();
    expect(uow.conversations.getConversation(projectA, conversationB.conversationId)).toBeUndefined();
    expect(uow.conversations.getMessage(projectA, messageB.messageId)).toBeUndefined();
    expect(uow.conversations.listMessages(projectA, conversationB.conversationId, { limit: 10 }).items).toHaveLength(0);
    expect(uow.collaboration.getThread(projectA, thread.threadId)).toBeUndefined();
    expect(uow.collaboration.getMessage(projectA, collabMessage.messageId)).toBeUndefined();
    expect(uow.collaboration.listMessages(projectA, { threadId: thread.threadId, limit: 10 })).toHaveLength(0);
    expect(uow.collaboration.listAttempts(projectA, collabMessage.messageId)).toHaveLength(0);
    expect(uow.collaboration.currentDeliveryState(projectA, collabMessage.messageId)).toBeUndefined();
    expect(uow.collaboration.currentProcessingState(projectA, collabMessage.messageId)).toBeUndefined();
    expect(uow.reviews.getItem(projectA, reviewB.reviewId)).toBeUndefined();
    expect(uow.reviews.listActions(projectA, reviewB.reviewId)).toHaveLength(0);
    expect(uow.contracts.get(projectA, contractB.contractId)).toBeUndefined();
    expect(uow.contracts.getCurrentByTask(projectA, taskB)).toBeUndefined();
    expect(uow.contracts.listVersions(projectA, contractB.contractId)).toHaveLength(0);
    expect(uow.hostStream.listBySession(projectA, sessionB.sessionId, { limit: 10 })).toHaveLength(0);
    expect(uow.hostStream.listBySessionRange(projectA, sessionB.sessionId, 1, 10)).toHaveLength(0);
    expect(uow.usage.listByTask(projectA, taskB, { limit: 10 }).items).toHaveLength(0);
    expect(uow.usage.sumByTask(projectA, taskB)).toEqual({ tokensIn: 0, tokensOut: 0, cost: 0 });
  });

  it("resolves the same reads inside the owning project", () => {
    const uow = createUnitOfWork(db);
    expect(uow.tasks.get(projectB, taskB)?.taskId).toBe(taskB);
    expect(uow.events.get(projectB, event.eventId)?.eventId).toBe(event.eventId);
    expect(uow.decisions.get(projectB, decision.decisionId)?.decisionId).toBe(decision.decisionId);
    expect(uow.traces.get(projectB, traceId)?.traceId).toBe(traceId);
    expect(uow.traces.listByDecision(projectB, decision.decisionId)).toHaveLength(1);
    expect(uow.decisions.listByTask(projectB, taskB, { limit: 10 }).items).toHaveLength(1);
    expect(uow.assertions.get(projectB, assertionB)?.assertionId).toBe(assertionB);
    expect(uow.assertions.listByTask(projectB, taskB, { limit: 10 }).items).toHaveLength(1);
    expect(uow.evidence.get(projectB, evidenceB)?.evidenceId).toBe(evidenceB);
    expect(uow.conversations.getConversation(projectB, conversationB.conversationId)?.conversationId).toBe(conversationB.conversationId);
    expect(uow.conversations.getMessage(projectB, messageB.messageId)?.messageId).toBe(messageB.messageId);
    expect(uow.conversations.listMessages(projectB, conversationB.conversationId, { limit: 10 }).items).toHaveLength(1);
    expect(uow.collaboration.getThread(thread.projectId, thread.threadId)?.threadId).toBe(thread.threadId);
    expect(uow.collaboration.getMessage(thread.projectId, collabMessage.messageId)?.messageId).toBe(collabMessage.messageId);
    expect(uow.collaboration.listMessages(thread.projectId, { threadId: thread.threadId, limit: 10 })).toHaveLength(1);
    expect(uow.collaboration.listAttempts(thread.projectId, collabMessage.messageId)).toHaveLength(1);
    expect(uow.collaboration.currentDeliveryState(thread.projectId, collabMessage.messageId)).toBe("delivered");
    expect(uow.collaboration.currentProcessingState(thread.projectId, collabMessage.messageId)).toBe("acknowledged");
    expect(uow.reviews.getItem(projectB, reviewB.reviewId)?.reviewId).toBe(reviewB.reviewId);
    expect(uow.reviews.listActions(projectB, reviewB.reviewId)).toHaveLength(1);
    expect(uow.contracts.get(projectB, contractB.contractId)?.contractId).toBe(contractB.contractId);
    expect(uow.contracts.getCurrentByTask(projectB, taskB)?.contractId).toBe(contractB.contractId);
    expect(uow.contracts.listVersions(projectB, contractB.contractId)).toHaveLength(1);
    expect(uow.hostStream.listBySession(projectB, sessionB.sessionId, { limit: 10 })).toHaveLength(1);
    expect(uow.hostStream.listBySessionRange(projectB, sessionB.sessionId, 1, 10)).toHaveLength(1);
    expect(uow.usage.listByTask(projectB, taskB, { limit: 10 }).items).toHaveLength(1);
    expect(uow.usage.sumByTask(projectB, taskB)).toEqual({ tokensIn: 120, tokensOut: 40, cost: 0.0002 });
  });

  it("validates the project argument on notification reads (schema gap documented in the repository)", () => {
    // notification_states carries no project column (no activities table to
    // join either), so these reads validate the argument but cannot scope
    // the SQL yet — the repository documents the gap in a code comment.
    const uow = createUnitOfWork(db);
    expectSestinaCode(
      () => uow.notifications.get("not-a-ulid", notificationIdB),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () => uow.notifications.listByActivity("not-a-ulid", notificationB.activityId),
      SestinaErrorCode.validation_failed,
    );
    // A valid-but-foreign project still resolves today (the honest current
    // behaviour): this assertion must flip to `undefined` once the
    // notification_states.project_id column lands (migration owned by the
    // migrations agent).
    expect(uow.notifications.get(projectA, notificationIdB)?.notificationId).toBe(notificationIdB);
  });
});
