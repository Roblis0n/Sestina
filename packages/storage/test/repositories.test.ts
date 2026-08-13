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
import { makeTempDir, removeTempDir, loadStorageFixture, loadSchemaFixture } from "./helpers.js";
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

  it("round-trips projects with bindings and snake_case columns", async () => {
    const uow = createUnitOfWork(db);
    const project = makeProject({
      bindings: [{ rootPath: join(dir, "work"), establishedAt: "2026-08-13T00:00:00.000Z", fingerprint: "fp-1" }],
    });
    await uow.commit((u) => {
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

  it("round-trips tasks and sessions", async () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const session = makeSession(task.taskId);
    await uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(session);
    });
    expect(uow.tasks.get(task.taskId)?.title).toBe("task title");
    const loadedSession = uow.sessions.get(session.sessionId);
    expect(loadedSession?.hostSessionId).toBe(session.hostSessionId);
    const byTask = uow.sessions.listByTask(task.taskId, { limit: 10 });
    expect(byTask.items).toHaveLength(1);
  });

  it("round-trips contracts with versions and rejects version conflicts", async () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const contract = loadSchemaFixture("valid-contract.json") as TaskContract;
    await uow.commit((u) => {
      u.projects.insert(project);
      // The contract's FK points at its own task id (fixture id).
      u.tasks.insert(makeTask(project.projectId, { taskId: contract.taskId }));
      u.contracts.insert(contract);
    });
    expect(uow.contracts.getCurrentByTask(contract.taskId)?.contractId).toBe(contract.contractId);

    const v2 = { ...contract, version: 2, updatedAt: "2026-08-13T01:00:00.000Z" };
    await uow.commit((u) => {
      u.contracts.addVersion(v2, 1);
    });
    expect(uow.contracts.listVersions(contract.contractId)).toHaveLength(2);

    const v4 = { ...contract, version: 4, updatedAt: "2026-08-13T02:00:00.000Z" };
    await expect(
      uow.commit((u) => {
        u.contracts.addVersion(v4, 2);
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.contract_version_mismatch;
    });
  });

  it("round-trips evidence and assertions with JSON schema validation", async () => {
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
    await uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.evidence.insert(evidence);
      u.assertions.insert(assertion);
    });
    const loaded = uow.evidence.get("E-001");
    expect(loaded?.excerpt).toBe("sensitive excerpt");
    expect(uow.assertions.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);

    // Invalid JSON data must be rejected before storage.
    await expect(
      uow.commit((u) => {
        u.evidence.insert({ ...evidence, evidenceId: "E-002", type: "not-a-type" } as never);
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.validation_failed;
    });
  });

  it("round-trips conversations, messages and context refs", async () => {
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
    await uow.commit((u) => {
      u.projects.insert(project);
      u.conversations.insertConversation(conversation);
      u.conversations.insertMessage(message);
    });
    const loaded = uow.conversations.getMessage(message.messageId);
    expect(loaded?.body).toBe("blocked write");
    expect(loaded?.contextRefs).toHaveLength(1);
    const list = uow.conversations.listMessages(conversation.conversationId, { limit: 10 });
    expect(list.items).toHaveLength(1);
  });

  it("round-trips reviews with append-only actions", async () => {
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
    await uow.commit((u) => {
      u.projects.insert(project);
      u.reviews.insertItem(item);
      u.reviews.appendAction(action);
    });
    expect(uow.reviews.getItem(item.reviewId)?.status).toBe("open");
    expect(uow.reviews.listActions(item.reviewId)).toHaveLength(1);
  });

  it("round-trips host stream events with sequence dedupe", async () => {
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
    await uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.sessions.insert(session);
      u.hostStream.append(streamEvent);
    });
    expect(uow.hostStream.listBySession(session.sessionId, { limit: 10 })).toHaveLength(1);
    // Duplicate (session_id, sequence) must be rejected.
    await expect(
      uow.commit((u) => {
        u.hostStream.append({ ...streamEvent, streamEventId: generateId() });
      }),
    ).rejects.toBeTruthy();
  });

  it("round-trips notifications and usage records", async () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const notification: NotificationState = {
      notificationId: generateId(),
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
    await uow.commit((u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.notifications.upsertState(notification);
      u.usage.insert(usage);
    });
    expect(uow.notifications.get(notification.notificationId)?.acknowledged).toBe(false);
    expect(uow.usage.sumByTask(task.taskId)).toEqual({ tokensIn: 120, tokensOut: 40, cost: 0.0002 });
  });

  it("round-trips collaboration threads, endpoints, messages, attempts and dual-state projections", async () => {
    const uow = createUnitOfWork(db);
    const thread = loadStorageFixture("valid-collaboration-thread.json") as CollaborationThread;
    const endpoint = loadStorageFixture("valid-collaboration-endpoint.json") as CollaborationEndpoint;
    const message = {
      ...(loadStorageFixture("valid-collaboration-message.json") as CollaborationMessage),
      // The fixture's timestamps are in the past; make the message live for
      // this test so attempts are not rejected as expired.
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    await uow.commit((u) => {
      // The fixtures' project/task ids must exist for the FKs.
      u.projects.insert(makeProject({ projectId: thread.projectId }));
      u.tasks.insert(makeTask(thread.projectId, { taskId: thread.taskId }));
      u.collaboration.insertThread(thread);
      u.collaboration.insertEndpoint(endpoint);
      u.collaboration.insertMessage(message);
    });
    expect(uow.collaboration.getThread(thread.threadId)?.title).toBe(thread.title);

    const attempt: CollaborationDeliveryAttempt = {
      attemptId: generateId(),
      messageId: message.messageId,
      targetEndpointId: endpoint.endpointId,
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
    await uow.commit((u) => {
      u.collaboration.appendAttempt(attempt);
      u.collaboration.appendAction(action);
    });
    // Dual-state projections stay separate: delivered ≠ accepted/completed.
    expect(uow.collaboration.currentDeliveryState(message.messageId)).toBe("delivered");
    expect(uow.collaboration.currentProcessingState(message.messageId)).toBe("acknowledged");
    // Attempts are append-only: a second attempt with its own sequence coexists.
    await uow.commit((u) => {
      u.collaboration.appendAttempt({ ...attempt, attemptId: generateId(), sequence: 2, status: "failed" });
    });
    expect(uow.collaboration.listAttempts(message.messageId)).toHaveLength(2);
  });

  it("round-trips events, decisions and traces with leases", async () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    const event = makeEvent(project.projectId, task.taskId);
    const decision = makeDecision(event);
    const traceFixture = loadSchemaFixture("valid-decision-trace.json") as DecisionTrace;
    await uow.commit((u) => {
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
    expect(uow.events.get(event.eventId)?.eventType).toBe("pre_tool");
    expect(uow.decisions.get(decision.decisionId)?.category).toBe("allow");
    expect(uow.decisions.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);
    expect(uow.traces.listByDecision(decision.decisionId)).toHaveLength(1);
  });

  it("enforces foreign keys through repositories", async () => {
    const uow = createUnitOfWork(db);
    const project = makeProject();
    const task = makeTask(project.projectId);
    await expect(
      uow.commit((u) => {
        u.tasks.insert(task); // project row missing → FK violation
      }),
    ).rejects.toBeTruthy();
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
