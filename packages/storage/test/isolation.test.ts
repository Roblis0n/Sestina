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
  const projectA = generateId(); // never seeded 鈥?must resolve nothing
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
    notificationId: notificationIdB, projectId: projectB, activityId: generateId(), deliveredAt: "2026-08-13T00:00:00.000Z",
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
      u.sessions.insert(projectB, sessionB);
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
    expect(uow.collaboration.listMessages(projectA, { threadId: thread.threadId, limit: 10 }).items).toHaveLength(0);
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
    expect(uow.collaboration.listMessages(thread.projectId, { threadId: thread.threadId, limit: 10 }).items).toHaveLength(1);
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

  it("validates the project argument on notification reads", () => {
    const uow = createUnitOfWork(db);
    expectSestinaCode(
      () => uow.notifications.get("not-a-ulid", notificationIdB),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () => uow.notifications.listByActivity("not-a-ulid", notificationB.activityId),
      SestinaErrorCode.validation_failed,
    );
    // notification_states now carries project_id (migration 008): a
    // valid-but-foreign project resolves nothing, exactly like every other
    // id-scoped read in this suite.
    expect(uow.notifications.get(projectA, notificationIdB)).toBeUndefined();
    expect(uow.notifications.listByActivity(projectA, notificationB.activityId)).toHaveLength(0);
  });

  it("rejects cross-project write mutations without touching the target", () => {
    const uow = createUnitOfWork(db);
    const taskBefore = uow.tasks.get(projectB, taskB);
    const reviewBefore = uow.reviews.getItem(projectB, reviewB.reviewId);
    const evidenceBefore = uow.evidence.get(projectB, evidenceB);
    const contractBefore = uow.contracts.getCurrentByTask(projectB, taskB);
    if (!taskBefore || !reviewBefore || !contractBefore) {
      throw new Error("fixture rows missing");
    }
    const endpoints = uow.collaboration.listEndpoints(thread.projectId);
    const processingBefore = uow.collaboration.currentProcessingState(
      thread.projectId,
      collabMessage.messageId,
    );

    // Cross-project tasks.update fails like a missing task and the target
    // row is untouched.
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.tasks.update(projectA, { ...taskBefore, title: "tampered" });
      });
    }, SestinaErrorCode.task_not_found);
    expect(uow.tasks.get(projectB, taskB)?.title).toBe(taskBefore.title);

    // Cross-project contracts.addVersion fails like a missing contract and
    // no new version lands.
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.contracts.addVersion(
          projectA,
          {
            ...contractBefore,
            version: contractBefore.version + 1,
            updatedAt: "2026-08-13T02:00:00.000Z",
          },
          contractBefore.version,
        );
      });
    }, SestinaErrorCode.contract_not_found);
    expect(uow.contracts.listVersions(projectB, contractBefore.contractId)).toHaveLength(1);

    // Cross-project evidence.updateStatus fails like a missing item and the
    // status stays put.
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.evidence.updateStatus(projectA, evidenceB, "verified");
      });
    }, SestinaErrorCode.evidence_not_found);
    expect(uow.evidence.get(projectB, evidenceB)?.status).toBe(evidenceBefore?.status);

    // Cross-project reviews.updateItem fails like a missing item and the
    // version/status stay put.
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.reviews.updateItem(projectA, reviewB.reviewId, {
          ...reviewBefore,
          status: "resolved" as const,
          resolvedAt: "2026-08-13T00:00:05.000Z",
          version: reviewBefore.version + 1,
        }, reviewBefore.version);
      });
    }, SestinaErrorCode.review_not_found);
    expect(uow.reviews.getItem(projectB, reviewB.reviewId)?.version).toBe(reviewBefore.version);
    expect(uow.reviews.getItem(projectB, reviewB.reviewId)?.status).toBe("open");

    // Cross-project collaboration.appendAction fails like a missing message
    // and no processing state is fabricated.
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.collaboration.appendAction(projectA, {
          actionId: generateId(),
          messageId: collabMessage.messageId,
          endpointId: endpoints[0]?.endpointId ?? generateId(),
          status: "completed",
          actedAt: "2026-08-13T02:06:00.000Z",
        });
      });
    }, SestinaErrorCode.collaboration_message_not_found);
    expect(
      uow.collaboration.currentProcessingState(thread.projectId, collabMessage.messageId),
    ).toBe(processingBefore);
  });

  it("leaves no project-less evidence.updateStatus path (scoping must fail closed)", () => {
    const uow = createUnitOfWork(db);
    const before = uow.evidence.get(projectB, evidenceB);
    // The pre-fence repository exposed a project-less update; the call below
    // is cast to that old shape. With the fence the first argument lands on
    // projectId, the shuffled call resolves nothing, and the row is safe.
    const projectLess = uow.evidence.updateStatus.bind(uow.evidence) as unknown as
      (evidenceId: string, status: string) => void;
    expectSestinaCode(() => {
      uow.commit((u) => {
        void u;
        projectLess(evidenceB, "verified");
      });
    }, SestinaErrorCode.evidence_not_found);
    expect(uow.evidence.get(projectB, evidenceB)?.status).toBe(before?.status);
  });

  it("uses the same error for missing ids as for foreign-project ids (no existence leak)", () => {
    const uow = createUnitOfWork(db);
    const taskBefore = uow.tasks.get(projectB, taskB);
    const reviewBefore = uow.reviews.getItem(projectB, reviewB.reviewId);
    const contractBefore = uow.contracts.getCurrentByTask(projectB, taskB);
    if (!taskBefore || !reviewBefore || !contractBefore) {
      throw new Error("fixture rows missing");
    }
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.tasks.update(projectA, { ...taskBefore, taskId: generateId() });
      });
    }, SestinaErrorCode.task_not_found);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.evidence.updateStatus(projectB, generateId(), "verified");
      });
    }, SestinaErrorCode.evidence_not_found);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.reviews.updateItem(projectB, generateId(), {
          ...reviewBefore,
          status: "resolved" as const,
          version: reviewBefore.version + 1,
        }, reviewBefore.version);
      });
    }, SestinaErrorCode.review_not_found);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.contracts.addVersion(
          projectB,
          {
            ...contractBefore,
            contractId: generateId(),
            version: contractBefore.version + 1,
            updatedAt: "2026-08-13T02:00:00.000Z",
          },
          contractBefore.version,
        );
      });
    }, SestinaErrorCode.contract_not_found);
    expectSestinaCode(() => {
      uow.commit((u) => {
        u.collaboration.appendAction(projectB, {
          actionId: generateId(),
          messageId: generateId(),
          endpointId: generateId(),
          status: "acknowledged",
          actedAt: "2026-08-13T02:06:00.000Z",
        });
      });
    }, SestinaErrorCode.collaboration_message_not_found);
  });
});
