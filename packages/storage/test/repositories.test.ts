import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  generateId,
  isSestinaError,
  SestinaErrorCode,
  type SestinaProject,
  type Task,
  type HostSession,
  type TaskContract,
  type EvidenceItem,
  type SituationAssertion,
  type Conversation,
  type ConversationMessage,
  type ReviewItem,
  type ReviewAction,
  type HostStreamEvent,
  type NotificationState,
  type ProviderUsage,
  type CollaborationThread,
  type CollaborationEndpoint,
  type CollaborationMessage,
  type CollaborationDeliveryAttempt,
  type CollaborationAction,
  type StandardEvent,
  type Decision,
  type DecisionTrace,
} from "@sestina/schema";
import { openDatabase, createUnitOfWork } from "../src/index.js";
import { makeTempDir, removeTempDir, loadSchemaFixture } from "./helpers.js";
import { expectSestinaCode } from "./helpers.js";
import { seedCollaboration } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

function makeProject(overrides: Partial<SestinaProject> = {}): SestinaProject {
  return {
    projectId: generateId(),
    name: "storage-project",
    bindings: [],
    status: "active",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function makeTask(projectId: string, overrides: Partial<Task> = {}): Task {
  return {
    taskId: generateId(),
    projectId,
    title: "task title",
    status: "active",
    priority: "normal",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function makeSession(taskId: string, overrides: Partial<HostSession> = {}): HostSession {
  return {
    sessionId: generateId(),
    taskId,
    host: "codex",
    hostSessionId: `host-${generateId()}`,
    visibilityLevel: "tool_lifecycle",
    status: "connected",
    capabilities: ["tool_interception"],
    startedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function makeEvent(projectId: string, taskId: string, overrides: Partial<StandardEvent> = {}): StandardEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: generateId(),
    idempotencyKey: generateId(),
    eventType: "pre_tool",
    host: "codex",
    projectId,
    taskId,
    sessionId: generateId(),
    occurredAt: "2026-08-13T00:00:00.000Z",
    receivedAt: "2026-08-13T00:00:00.050Z",
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: "a".repeat(64),
    ...overrides,
  };
}

function makeDecision(event: StandardEvent, overrides: Partial<Decision> = {}): Decision {
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
    ...overrides,
  };
}

describe("Typed repositories round-trip (docs/22 Task 6)", () => {
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

  it("round-trips projects with bindings and snake_case columns", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject({
      bindings: [{ rootPath: join(dir, "work"), establishedAt: "2026-08-13T00:00:00.000Z", fingerprint: "fp-1" }],
    });
    uow.commit((u) => {
      u.projects.insert(project);
    });
    const raw = db.get<{ project_id: string; display_name: string }>(
      "SELECT project_id, display_name FROM projects WHERE project_id = ?",
      project.projectId,
    );
    expect(raw?.project_id).toBe(project.projectId);
    expect(raw?.display_name).toBe(project.name);
    const loaded = uow.projects.get(project.projectId);
    expect(loaded?.bindings).toHaveLength(1);
    expect(loaded?.bindings[0]?.rootPath).toBe(join(dir, "work"));
  });

  it("round-trips tasks and sessions", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const session = makeSession(task.taskId);
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(project.projectId, session);
    });
    expect(uow.tasks.get(project.projectId, task.taskId)?.title).toBe("task title");
    const loadedSession = uow.sessions.get(project.projectId, session.sessionId);
    expect(loadedSession?.hostSessionId).toBe(session.hostSessionId);
    const byTask = uow.sessions.listByTask(project.projectId, task.taskId, { limit: 10 });
    expect(byTask.items).toHaveLength(1);
  });

  it("pages projects with keyset cursors (no offset scans)", () => {
    const uow = createUnitOfWork(db);
    const projects = [0, 1, 2].map((i) =>
      makeProject({ projectId: generateId(), createdAt: `2026-08-13T00:00:0${i}.000Z` }),
    );
    uow.commit((u) => {
      for (const project of projects) u.projects.insert(project);
    });
    const page1 = uow.projects.list({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
    const page2 = uow.projects.list({ cursor: page1.nextCursor, limit: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
    const seen = [...page1.items, ...page2.items].map((p) => p.projectId);
    expect(new Set(seen).size).toBe(3);
  });

  it("round-trips contracts with versions and rejects version conflicts", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const contract = loadSchemaFixture("valid-contract.json") as TaskContract;
    uow.commit((u) => {
      u.projects.insert(project);
      // The contract's FK points at its own task id (fixture id).
      u.tasks.insert(makeTask(project.projectId, { taskId: contract.taskId }));
      u.contracts.insert(contract);
    });
    expect(uow.contracts.getCurrentByTask(project.projectId, contract.taskId)?.contractId).toBe(contract.contractId);

    const v2 = { ...contract, version: 2, updatedAt: "2026-08-13T01:00:00.000Z" };
    uow.commit((u) => {
      u.contracts.addVersion(project.projectId, v2, 1);
    });
    expect(uow.contracts.listVersions(project.projectId, contract.contractId)).toHaveLength(2);

    const v4 = { ...contract, version: 4, updatedAt: "2026-08-13T02:00:00.000Z" };
    expectSestinaCode(() =>
      { uow.commit((u) => {
        u.contracts.addVersion(project.projectId, v4, 2);
      }); },
      SestinaErrorCode.contract_version_mismatch);
  });

  it("round-trips evidence and assertions with JSON schema validation", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const evidence: EvidenceItem = {
      evidenceId: "E-001",
      taskId: task.taskId,
      type: "primary_source",
      locator: { type: "path", value: "/data/raw.csv" },
      excerpt: "sensitive excerpt",
      status: "verified",
      provenance: "user upload",
      recordedBy: "user",
      observedAt: "2026-08-13T00:00:00.000Z",
    };
    const assertion: SituationAssertion = {
      assertionId: generateId(),
      projectId: project.projectId,
      taskId: task.taskId,
      kind: "confirmed_fact",
      statement: "dataset contains 100 rows",
      sourceRefs: [],
      limitations: [],
      status: "active",
      validFrom: "2026-08-13T00:00:00.000Z",
    };
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.evidence.insert(evidence);
      u.assertions.insert(assertion);
    });
    const loaded = uow.evidence.get(project.projectId, "E-001");
    expect(loaded?.excerpt).toBe("sensitive excerpt");
    expect(uow.assertions.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);

    // Invalid JSON data must be rejected before storage.
    expectSestinaCode(() =>
      { uow.commit((u) => {
        u.evidence.insert({ ...evidence, evidenceId: "E-002", type: "not-a-type" } as never);
      }); },
      SestinaErrorCode.validation_failed);
  });

  it("round-trips conversations, messages and context refs", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const conversation: Conversation = {
      conversationId: generateId(),
      projectId: project.projectId,
      type: "governance_chat",
      title: "governance chat",
      status: "active",
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const message: ConversationMessage = {
      messageId: generateId(),
      conversationId: conversation.conversationId,
      role: "sestina",
      body: "blocked write",
      contextRefs: [{ refType: "task", refId: generateId(), resolutionStatus: "current" }],
      confirmable: false,
      status: "complete",
      createdAt: "2026-08-13T00:00:00.100Z",
    };
    uow.commit((u) => {
      u.projects.insert(project);
      u.conversations.insertConversation(conversation);
      u.conversations.insertMessage(message);
    });
    const loaded = uow.conversations.getMessage(project.projectId, message.messageId);
    expect(loaded?.body).toBe("blocked write");
    expect(loaded?.contextRefs).toHaveLength(1);
    const list = uow.conversations.listMessages(project.projectId, conversation.conversationId, { limit: 10 });
    expect(list.items).toHaveLength(1);
  });

  it("pages conversation messages with keyset cursors (no dupes, real nextCursor)", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const conversation: Conversation = {
      conversationId: generateId(),
      projectId: project.projectId,
      type: "governance_chat",
      title: "paged governance chat",
      status: "active",
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const messages = [0, 1, 2].map((i) => ({
      messageId: generateId(),
      conversationId: conversation.conversationId,
      role: "sestina" as const,
      body: `paged-message-${i}`,
      contextRefs: [],
      confirmable: false,
      status: "complete" as const,
      createdAt: `2026-08-13T00:00:0${i}.000Z`,
    }));
    uow.commit((u) => {
      u.projects.insert(project);
      u.conversations.insertConversation(conversation);
      for (const message of messages) u.conversations.insertMessage(message);
    });
    const page1 = uow.conversations.listMessages(project.projectId, conversation.conversationId, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
    const page2 = uow.conversations.listMessages(project.projectId, conversation.conversationId, {
      cursor: page1.nextCursor,
      limit: 2,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
    const seen = [...page1.items, ...page2.items].map((m) => m.messageId);
    expect(new Set(seen).size).toBe(3);
  });

  it("round-trips reviews with append-only actions", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const item: ReviewItem = {
      reviewId: generateId(),
      projectId: project.projectId,
      taskId: generateId(),
      trigger: "overridable_block",
      title: "review title",
      description: "review description",
      requiredDecision: "allow or block",
      availableActions: ["accept"],
      contextRefs: [],
      status: "open",
      priority: 3,
      openedAt: "2026-08-13T00:00:00.000Z",
      version: 1,
    };
    const action: ReviewAction = {
      reviewId: item.reviewId,
      action: "accept",
      reason: "user confirmed",
      performedBy: { actor: "user", channel: "desktop", directUser: true },
      performedAt: "2026-08-13T00:01:00.000Z",
    };
    uow.commit((u) => {
      u.projects.insert(project);
      u.reviews.insertItem(item);
      u.reviews.appendAction(action);
    });
    expect(uow.reviews.getItem(project.projectId, item.reviewId)?.status).toBe("open");
    expect(uow.reviews.listActions(project.projectId, item.reviewId)).toHaveLength(1);
  });

  it("round-trips host stream events with sequence dedupe", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const session = makeSession(task.taskId);
    const streamEvent: HostStreamEvent = {
      streamEventId: generateId(),
      sessionId: session.sessionId,
      sequence: 1,
      eventType: "tool_start",
      content: "tool started",
      sourceCapability: "tool_lifecycle",
      occurredAt: "2026-08-13T00:00:00.000Z",
    };
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(project.projectId, session);
      u.hostStream.append(streamEvent);
    });
    expect(uow.hostStream.listBySession(project.projectId, session.sessionId, { limit: 10 })).toHaveLength(1);
    // Duplicate (session_id, sequence) must be rejected.
    expect(() =>
      { uow.commit((u) => {
        u.hostStream.append({ ...streamEvent, streamEventId: generateId() });
      }); },
    ).toThrow();
  });

  it("round-trips notifications and usage records", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const notification: NotificationState = {
      notificationId: generateId(),
      projectId: project.projectId,
      activityId: generateId(),
      deliveredAt: "2026-08-13T00:00:00.000Z",
      channel: "feed_item",
      acknowledged: false,
    };
    const usage: ProviderUsage = {
      usageId: generateId(),
      providerId: "openai-main",
      taskId: task.taskId,
      model: "gpt-5",
      callAt: "2026-08-13T00:00:00.000Z",
      tokensIn: 120,
      tokensOut: 40,
      cost: 0.0002,
    };
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.notifications.upsertState(notification);
      u.usage.insert(usage);
    });
    expect(uow.notifications.get(project.projectId, notification.notificationId)?.acknowledged).toBe(false);
    expect(uow.usage.sumByTask(project.projectId, task.taskId)).toEqual({ tokensIn: 120, tokensOut: 40, cost: 0.0002 });
    expect(uow.usage.listByTask(project.projectId, task.taskId, { limit: 10 }).items).toHaveLength(1);
  });

  it("fences notification reads to their stored project and fails closed on legacy rows", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const other = makeProject();
    const task = makeTask(project.projectId);
    const notification: NotificationState = {
      notificationId: generateId(),
      projectId: project.projectId,
      activityId: generateId(),
      deliveredAt: "2026-08-13T00:00:00.000Z",
      channel: "feed_item",
      acknowledged: false,
    };
    uow.commit((u) => {
      u.projects.insert(project);
      u.projects.insert(other);
      u.tasks.insert(task);
      u.notifications.upsertState(notification);
    });
    expect(uow.notifications.get(project.projectId, notification.notificationId)).toBeDefined();
    // A foreign project resolves nothing (migration 008 fence).
    expect(uow.notifications.get(other.projectId, notification.notificationId)).toBeUndefined();
    expect(uow.notifications.listByActivity(other.projectId, notification.activityId)).toHaveLength(0);

    // A legacy pre-008 row (no project_id, default sentinel) fails closed
    // under every project instead of leaking to one of them.
    const legacyId = generateId();
    const legacyActivityId = generateId();
    db.run(
      `INSERT INTO notification_states (notification_id, activity_id, channel, delivered_at, acknowledged, data)
       VALUES (?, ?, 'feed_item', ?, 0, ?)`,
      legacyId,
      legacyActivityId,
      Date.now(),
      JSON.stringify({
        notificationId: legacyId,
        activityId: legacyActivityId,
        deliveredAt: new Date(Date.now()).toISOString(),
        channel: "feed_item",
        acknowledged: false,
        projectId: project.projectId,
      }),
    );
    expect(uow.notifications.get(project.projectId, legacyId)).toBeUndefined();
    expect(uow.notifications.get(other.projectId, legacyId)).toBeUndefined();
    expect(uow.notifications.listByActivity(project.projectId, legacyActivityId)).toHaveLength(0);
  });

  it("validates host-stream listBySession limits", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const session = makeSession(task.taskId);
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(project.projectId, session);
    });
    expectSestinaCode(
      () => uow.hostStream.listBySession(project.projectId, session.sessionId, { limit: 0 }),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () => uow.hostStream.listBySession(project.projectId, session.sessionId, { limit: 501 }),
      SestinaErrorCode.validation_failed,
    );
    expectSestinaCode(
      () => uow.hostStream.listBySession(project.projectId, session.sessionId, { limit: 1.5 }),
      SestinaErrorCode.validation_failed,
    );
  });

  it("round-trips collaboration threads, endpoints, messages, attempts and dual-state projections", () => {
    const uow = createUnitOfWork(db);
    const seeded = seedCollaboration(db);
    const thread = seeded.thread as CollaborationThread;
    const endpoint = seeded.endpoint as CollaborationEndpoint;
    const message = seeded.message as CollaborationMessage;
    uow.commit((u) => {
      // thread/endpoints/evidence are seeded by seedCollaboration.
      u.collaboration.insertMessage(message);
    });
    expect(uow.collaboration.getThread(thread.projectId, thread.threadId)?.title).toBe(thread.title);

    const reserved = uow.commit((u) =>
      u.collaboration.reserveDelivery({
        messageId: message.messageId,
        targetEndpointId: seeded.targetEndpointId,
        ownerId: "repo-deliverer",
      }),
    );
    expect(reserved.kind).toBe("acquired");
    const credential = reserved.kind === "acquired" ? reserved.credential : { ownerId: "", token: "" };

    const attempt: CollaborationDeliveryAttempt = {
      attemptId: generateId(),
      messageId: message.messageId,
      targetEndpointId: seeded.targetEndpointId,
      sequence: 1,
      route: "mcp-inbox",
      status: "delivered",
      startedAt: "2026-08-13T02:00:01.000Z",
    };
    const action: CollaborationAction = {
      actionId: generateId(),
      messageId: message.messageId,
      endpointId: endpoint.endpointId,
      status: "acknowledged",
      actedAt: "2026-08-13T02:05:00.000Z",
    };
    uow.commit((u) => {
      u.collaboration.appendAttempt(attempt, credential);
      u.collaboration.appendAction(thread.projectId, action);
    });
    // Dual-state projections stay separate: delivered 鈮?accepted/completed.
    expect(uow.collaboration.currentDeliveryState(thread.projectId, message.messageId)).toBe("delivered");
    expect(uow.collaboration.currentProcessingState(thread.projectId, message.messageId)).toBe("acknowledged");
    // Attempts are append-only: a second attempt with its own sequence coexists.
    uow.commit((u) => {
      u.collaboration.appendAttempt({ ...attempt, attemptId: generateId(), sequence: 2, status: "failed" }, credential);
    });
    expect(uow.collaboration.listAttempts(thread.projectId, message.messageId)).toHaveLength(2);
  });

  it("pages collaboration messages with keyset cursors (thread scope, no dupes)", () => {
    const uow = createUnitOfWork(db);
    const seeded = seedCollaboration(db);
    const thread = seeded.thread as CollaborationThread;
    const base = seeded.message as CollaborationMessage;
    const extras = [1, 2].map((i) => ({
      ...base,
      messageId: generateId(),
      dedupeKey: `repo-paging-${i}-${generateId()}`,
      createdAt: `2026-08-13T00:00:0${i}.000Z`,
    }));
    uow.commit((u) => {
      u.collaboration.insertMessage(base);
      for (const extra of extras) u.collaboration.insertMessage(extra);
    });
    const page1 = uow.collaboration.listMessages(thread.projectId, {
      threadId: thread.threadId,
      limit: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
    const page2 = uow.collaboration.listMessages(thread.projectId, {
      threadId: thread.threadId,
      cursor: page1.nextCursor,
      limit: 2,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
    const seen = [...page1.items, ...page2.items].map((m) => m.messageId);
    expect(new Set(seen).size).toBe(3);
  });

  it("round-trips events, decisions and traces with leases", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const event = makeEvent(project.projectId, task.taskId);
    const decision = makeDecision(event);
    const traceFixture = loadSchemaFixture("valid-decision-trace.json") as DecisionTrace;
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      const reserved = u.events.reserve(event, { ownerId: "owner-a" });
      expect(reserved.kind).toBe("created");
      if (reserved.kind === "created") {
        u.decisions.complete({
          lease: reserved.lease,
          decision,
          trace: { ...traceFixture, traceId: generateId(), decisionId: decision.decisionId, eventId: event.eventId },
        });
      }
    });
    expect(uow.events.get(project.projectId, event.eventId)?.eventType).toBe("pre_tool");
    expect(uow.decisions.get(project.projectId, decision.decisionId)?.category).toBe("allow");
    expect(uow.decisions.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);
    expect(uow.traces.listByDecision(project.projectId, decision.decisionId)).toHaveLength(1);
  });

  it("pages decisions with keyset cursors without gaps or overlaps", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const decisionIds: string[] = [];
    uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      for (let i = 0; i < 5; i++) {
        const event = makeEvent(project.projectId, task.taskId);
        const reserved = u.events.reserve(event, { ownerId: `pager-${i}` });
        if (reserved.kind === "created") {
          const decision = makeDecision(event);
          decisionIds.push(decision.decisionId);
          u.decisions.complete({ lease: reserved.lease, decision });
        }
      }
    });
    const page1 = uow.decisions.listByProject(project.projectId, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
    const page2 = uow.decisions.listByProject(project.projectId, { cursor: page1.nextCursor, limit: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeDefined();
    const page3 = uow.decisions.listByProject(project.projectId, { cursor: page2.nextCursor, limit: 2 });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeUndefined();
    const seen = [...page1.items, ...page2.items, ...page3.items].map((d) => d.decisionId);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });

  it("enforces foreign keys through repositories", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    expect(() =>
      { uow.commit((u) => {
        u.tasks.insert(task); // project row missing 鈫?FK violation
      }); },
    ).toThrow();
  });

  it("rejects repository writes outside a transaction", () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    try {
      uow.projects.insert(project);
      expect.unreachable("write outside a transaction must throw");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
    }
  });
});
