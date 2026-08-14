import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  generateId,
  SestinaErrorCode,
  type SestinaProject,
  type Task,
  type TaskContract,
  type HostSession,
  type SessionAttachment,
  type UnownedActivity,
  type CollaborationEndpoint,
  type StandardEvent,
} from "@sestina/schema";
import { loadSchemaFixture } from "./helpers.js";
import { openDatabase, createUnitOfWork, sha256, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir, expectSestinaCode } from "./helpers.js";

function makeProject(overrides: Partial<SestinaProject> = {}): SestinaProject {
  return {
    projectId: generateId(),
    name: "task8-project",
    bindings: [],
    status: "active",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

function makeTask(projectId: string, overrides: Partial<Task> = {}): Task {
  return {
    taskId: generateId(),
    projectId,
    title: "task8 task",
    status: "active",
    priority: "normal",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

function makeSession(overrides: Partial<HostSession> = {}): HostSession {
  return {
    sessionId: generateId(),
    host: "codex",
    hostSessionId: `host-${generateId()}`,
    visibilityLevel: "tool_lifecycle",
    status: "connected",
    capabilities: ["tool_interception"],
    startedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

function makeAttachment(sessionId: string, projectId: string, taskId: string): SessionAttachment {
  return {
    attachmentId: generateId(),
    sessionId,
    projectId,
    taskId,
    attachedAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("Task 8 storage repositories (docs/22 Task 8, docs/30)", () => {
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

  describe("sessions (project-fenced, nullable task)", () => {
    it("inserts a session with an explicit project fence and rejects a cross-project task", () => {
      const uow = createUnitOfWork(db);
      const projectA = makeProject();
      const projectB = makeProject();
      const taskB = makeTask(projectB.projectId);
      const session = makeSession({ taskId: taskB.taskId });
      uow.commit((u) => {
        u.projects.insert(projectA);
        u.projects.insert(projectB);
        u.tasks.insert(taskB);
      });
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.sessions.insert(projectA.projectId, session);
        });
      }, SestinaErrorCode.task_not_found);
    });

    it("inserts an unattached session (taskId undefined) and reads it back with a null task", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const session = makeSession();
      uow.commit((u) => {
        u.projects.insert(project);
        u.sessions.insert(project.projectId, session);
      });
      const record = uow.sessions.get(project.projectId, session.sessionId);
      expect(record?.projectId).toBe(project.projectId);
      expect(record?.taskId).toBeUndefined();
    });

    it("finds a session by its natural host key across projects", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task = makeTask(project.projectId);
      const session = makeSession({ taskId: task.taskId, hostSessionId: "host-natural-1" });
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task);
        u.sessions.insert(project.projectId, session);
      });
      const record = uow.sessions.getByHostSessionId("codex", "host-natural-1");
      expect(record?.sessionId).toBe(session.sessionId);
      expect(record?.projectId).toBe(project.projectId);
    });

    it("pages sessions by project", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const sessions = [0, 1, 2].map((i) =>
        makeSession({ startedAt: `2026-08-14T00:00:0${i}.000Z` }),
      );
      uow.commit((u) => {
        u.projects.insert(project);
        for (const session of sessions) u.sessions.insert(project.projectId, session);
      });
      const page = uow.sessions.listByProject(project.projectId, { limit: 2 });
      expect(page.items.map((s) => s.sessionId)).toEqual([sessions[0]?.sessionId, sessions[1]?.sessionId]);
      expect(page.nextCursor).toBeDefined();
      const rest = uow.sessions.listByProject(project.projectId, { limit: 2, cursor: page.nextCursor });
      expect(rest.items.map((s) => s.sessionId)).toEqual([sessions[2]?.sessionId]);
    });

    it("attaches a session to a task with compare-and-swap semantics", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task1 = makeTask(project.projectId);
      const task2 = makeTask(project.projectId);
      const session = makeSession({ taskId: task1.taskId });
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task1);
        u.tasks.insert(task2);
        u.sessions.insert(project.projectId, session);
      });
      uow.commit((u) => {
        u.sessions.attach(project.projectId, session.sessionId, task2.taskId, {
          expectedTaskId: task1.taskId,
        });
      });
      expect(uow.sessions.get(project.projectId, session.sessionId)?.taskId).toBe(task2.taskId);

      // The stale expected value fails the CAS.
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.sessions.attach(project.projectId, session.sessionId, task1.taskId, {
            expectedTaskId: task1.taskId,
          });
        });
      }, SestinaErrorCode.stale_state);
    // The failed CAS left the attachment untouched (post-condition).
    expect(uow.sessions.get(project.projectId, session.sessionId)?.taskId).toBe(task2.taskId);
    });

    it("pages sessions by task with stable keysets", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task = makeTask(project.projectId);
      const otherTask = makeTask(project.projectId);
      const sessions = [0, 1, 2].map((i) =>
        makeSession({ taskId: task.taskId, startedAt: `2026-08-14T00:00:0${i}.000Z` }),
      );
      const unrelated = makeSession({ taskId: otherTask.taskId, startedAt: "2026-08-14T00:00:04.000Z" });
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task);
        u.tasks.insert(otherTask);
        for (const session of [...sessions, unrelated]) u.sessions.insert(project.projectId, session);
      });
      const page = uow.sessions.listByTask(project.projectId, task.taskId, { limit: 2 });
      expect(page.items.map((s) => s.sessionId)).toEqual([sessions[0]?.sessionId, sessions[1]?.sessionId]);
      expect(page.nextCursor).toBeDefined();
      const rest = uow.sessions.listByTask(project.projectId, task.taskId, {
        limit: 2,
        cursor: page.nextCursor,
      });
      expect(rest.items.map((s) => s.sessionId)).toEqual([sessions[2]?.sessionId]);
    });

    it("detaches a session by attaching null and refuses a task outside the project", () => {
      const uow = createUnitOfWork(db);
      const projectA = makeProject();
      const projectB = makeProject();
      const taskA = makeTask(projectA.projectId);
      const taskB = makeTask(projectB.projectId);
      const session = makeSession({ taskId: taskA.taskId });
      uow.commit((u) => {
        u.projects.insert(projectA);
        u.projects.insert(projectB);
        u.tasks.insert(taskA);
        u.tasks.insert(taskB);
        u.sessions.insert(projectA.projectId, session);
      });
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.sessions.attach(projectA.projectId, session.sessionId, taskB.taskId);
        });
      }, SestinaErrorCode.task_not_found);

      uow.commit((u) => {
        u.sessions.attach(projectA.projectId, session.sessionId, null, {
          expectedTaskId: taskA.taskId,
        });
      });
      expect(uow.sessions.get(projectA.projectId, session.sessionId)?.taskId).toBeUndefined();
    });
  });

  describe("root bindings (canonical columns)", () => {
    it("round-trips canonical binding columns and finds by fingerprint", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      uow.commit((u) => {
        u.projects.insert(project);
      });
      const rootPath = join(dir, "work-root");
      uow.commit((u) => {
        u.rootBindings.insert({
          projectId: project.projectId,
          rootPath,
          status: "active",
          establishedAt: "2026-08-14T00:00:00.000Z",
          fingerprint: "fp-canon-1",
          confirmed: true,
          source: "user_confirmed",
          caseSemantics: "case_insensitive",
        });
      });
      const loaded = uow.rootBindings.get(project.projectId, rootPath);
      expect(loaded?.fingerprint).toBe("fp-canon-1");
      expect(loaded?.confirmed).toBe(true);
      expect(loaded?.source).toBe("user_confirmed");
      expect(loaded?.caseSemantics).toBe("case_insensitive");

      const byFingerprint = uow.rootBindings.findActiveByFingerprint("fp-canon-1");
      expect(byFingerprint.map((b) => b.projectId)).toEqual([project.projectId]);
    });

    it("confirms a binding and moves it between statuses", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const rootPath = join(dir, "confirm-root");
      uow.commit((u) => {
        u.projects.insert(project);
        u.rootBindings.insert({
          projectId: project.projectId,
          rootPath,
          status: "active",
          establishedAt: "2026-08-14T00:00:00.000Z",
          fingerprint: "fp-confirm-1",
          confirmed: false,
          source: "discovered",
        });
      });
      uow.commit((u) => {
        u.rootBindings.confirm(project.projectId, rootPath);
      });
      const confirmed = uow.rootBindings.get(project.projectId, rootPath);
      expect(confirmed?.confirmed).toBe(true);
      expect(confirmed?.source).toBe("user_confirmed");

      uow.commit((u) => {
        u.rootBindings.setStatus(project.projectId, rootPath, "archived");
      });
      expect(uow.rootBindings.findActiveByFingerprint("fp-confirm-1")).toHaveLength(0);
      expect(uow.rootBindings.listByProject(project.projectId).map((b) => b.status)).toEqual(["archived"]);
    });
  });

  describe("session attachments (append-only history)", () => {
    it("records the attach history and the current attachment", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task1 = makeTask(project.projectId);
      const task2 = makeTask(project.projectId);
      const session = makeSession({ taskId: task1.taskId });
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task1);
        u.tasks.insert(task2);
        u.sessions.insert(project.projectId, session);
        u.sessionAttachments.insert(makeAttachment(session.sessionId, project.projectId, task1.taskId));
      });
      expect(uow.sessionAttachments.current(project.projectId, session.sessionId)?.taskId).toBe(task1.taskId);

      uow.commit((u) => {
        u.sessionAttachments.detach(project.projectId, session.sessionId, "2026-08-14T01:00:00.000Z", "task re-planned");
        u.sessionAttachments.insert({
          ...makeAttachment(session.sessionId, project.projectId, task2.taskId),
          attachedAt: "2026-08-14T01:00:00.000Z",
        });
      });
      const history = uow.sessionAttachments.listBySession(project.projectId, session.sessionId);
      expect(history).toHaveLength(2);
      expect(history[0]?.detachedAt).toBe("2026-08-14T01:00:00.000Z");
      expect(history[0]?.reason).toBe("task re-planned");
      expect(uow.sessionAttachments.current(project.projectId, session.sessionId)?.taskId).toBe(task2.taskId);
    });

    it("fences detachment on the attachment's project and refuses a second detach", () => {
      const uow = createUnitOfWork(db);
      const projectA = makeProject();
      const projectB = makeProject();
      const taskA = makeTask(projectA.projectId);
      const session = makeSession({ taskId: taskA.taskId });
      uow.commit((u) => {
        u.projects.insert(projectA);
        u.projects.insert(projectB);
        u.tasks.insert(taskA);
        u.sessions.insert(projectA.projectId, session);
        u.sessionAttachments.insert(makeAttachment(session.sessionId, projectA.projectId, taskA.taskId));
      });
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.sessionAttachments.detach(projectB.projectId, session.sessionId, "2026-08-14T01:00:00.000Z");
        });
      }, SestinaErrorCode.session_not_found);

      uow.commit((u) => {
        u.sessionAttachments.detach(projectA.projectId, session.sessionId, "2026-08-14T01:00:00.000Z");
      });
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.sessionAttachments.detach(projectA.projectId, session.sessionId, "2026-08-14T02:00:00.000Z");
        });
      }, SestinaErrorCode.session_not_found);
    });
  });

  describe("unowned activity queue", () => {
    it("pages pending activities and resolves them", () => {
      const uow = createUnitOfWork(db);
      const activities: UnownedActivity[] = [0, 1, 2].map((i) => ({
        unownedId: generateId(),
        host: "codex",
        hostSessionId: `hs-${i}`,
        occurredAt: "2026-08-14T00:00:00.000Z",
        reason: "no_project",
        rawEvent: `{"type":"turn.started","n":${i}}`,
        payloadHash: sha256(`{"type":"turn.started","n":${i}}`),
        createdAt: `2026-08-14T00:00:0${i}.000Z`,
      }));
      uow.commit((u) => {
        for (const activity of activities) u.unownedActivity.insert(activity);
      });
      const page = uow.unownedActivity.listPending({ limit: 2 });
      expect(page.items.map((a) => a.unownedId)).toEqual([activities[0]?.unownedId, activities[1]?.unownedId]);
      const rest = uow.unownedActivity.listPending({ limit: 2, cursor: page.nextCursor });
      expect(rest.items.map((a) => a.unownedId)).toEqual([activities[2]?.unownedId]);

      // Resolution targets are real, seeded rows: the storage contract
      // round-trips the attribution the service validated (docs/30 §10).
      const target = activities[1];
      if (!target) throw new Error("fixture missing");
      const resolvedProject = makeProject();
      const resolvedTask = makeTask(resolvedProject.projectId);
      uow.commit((u) => {
        u.projects.insert(resolvedProject);
        u.tasks.insert(resolvedTask);
        u.unownedActivity.resolve(target.unownedId, {
          projectId: resolvedProject.projectId,
          taskId: resolvedTask.taskId,
        });
      });
      expect(uow.unownedActivity.get(target.unownedId)?.resolvedProjectId).toBe(resolvedProject.projectId);
      expect(uow.unownedActivity.get(target.unownedId)?.resolvedTaskId).toBe(resolvedTask.taskId);
      expect(uow.unownedActivity.listPending({ limit: 10 }).items).toHaveLength(2);

      // Resolving a second time is an idempotency violation.
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.unownedActivity.resolve(target.unownedId, {
            projectId: resolvedProject.projectId,
            taskId: null,
          });
        });
      }, SestinaErrorCode.idempotency_violation);
    });

    it("rejects invalid queue inserts at write time", () => {
      const uow = createUnitOfWork(db);
      const activity: UnownedActivity = {
        unownedId: generateId(),
        host: "codex",
        hostSessionId: "hs-bad",
        occurredAt: "2026-08-14T00:00:00.000Z",
        reason: "no_project",
        rawEvent: '{"type":"turn.started"}',
        payloadHash: "f".repeat(64), // not the sha256 of rawEvent
        createdAt: "2026-08-14T00:00:00.000Z",
      };
      // A hash that does not match the raw event is refused at write time,
      // not left to poison every subsequent queue read.
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.unownedActivity.insert(activity);
        });
      }, SestinaErrorCode.validation_failed);
      // An invalid reason is refused here too, before it can corrupt reads.
      const badReason = { ...activity, reason: "bogus" as UnownedActivity["reason"] };
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.unownedActivity.insert(badReason);
        });
      }, SestinaErrorCode.validation_failed);
      // Nothing partial was written.
      expect(uow.unownedActivity.listPending({ limit: 10 }).items).toHaveLength(0);
    });
  });

  describe("collaboration endpoint capability update", () => {
    function makeEndpoint(projectId: string, taskId: string, capability: CollaborationEndpoint["capability"]): CollaborationEndpoint {
      return {
        endpointId: generateId(),
        projectId,
        taskId,
        host: "codex",
        hostSessionId: `host-${generateId()}`,
        capability,
        transportIds: [],
        inboundPolicy: "accept",
        connected: true,
        lastSeenAt: "2026-08-14T00:00:00.000Z",
      };
    }

    it("updates capability with CAS and rejects stale expectations", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task = makeTask(project.projectId);
      const endpoint = makeEndpoint(project.projectId, task.taskId, "realtime");
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task);
        u.collaboration.insertEndpoint(endpoint);
      });

      uow.commit((u) => {
        u.collaboration.updateEndpoint(project.projectId, { ...endpoint, capability: "next_turn" }, {
          expectedCapability: "realtime",
        });
      });
      expect(uow.collaboration.listEndpoints(project.projectId)[0]?.capability).toBe("next_turn");

      expectSestinaCode(() => {
        uow.commit((u) => {
          u.collaboration.updateEndpoint(project.projectId, { ...endpoint, capability: "queued" }, {
            expectedCapability: "realtime",
          });
        });
      }, SestinaErrorCode.stale_state);
      // The failed CAS left the endpoint untouched (post-condition).
      expect(uow.collaboration.listEndpoints(project.projectId)[0]?.capability).toBe("next_turn");

      expectSestinaCode(() => {
        uow.commit((u) => {
          u.collaboration.updateEndpoint(project.projectId, makeEndpoint(project.projectId, task.taskId, "realtime"));
        });
      }, SestinaErrorCode.collaboration_endpoint_not_found);
    });

    it("persists inbound policy changes through the dedicated column", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task = makeTask(project.projectId);
      const endpoint = makeEndpoint(project.projectId, task.taskId, "realtime");
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task);
        u.collaboration.insertEndpoint(endpoint);
      });

      uow.commit((u) => {
        u.collaboration.updateEndpoint(project.projectId, { ...endpoint, inboundPolicy: "hold" }, {
          expectedCapability: "realtime",
        });
      });
      expect(uow.collaboration.listEndpoints(project.projectId)[0]?.inboundPolicy).toBe("hold");

      // The column and the JSON payload must stay in agreement.
      const read = uow.collaboration.listEndpoints(project.projectId)[0];
      expect(read?.capability).toBe("realtime");
      expect(read?.connected).toBe(true);
      expect(read?.lastSeenAt).toBe(endpoint.lastSeenAt);
    });
  });

  describe("contract revision reasons (docs/30 §6 reopen)", () => {
    it("records the reopen reason on the new version only", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const contract = loadSchemaFixture("valid-contract.json") as TaskContract;
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(makeTask(project.projectId, { taskId: contract.taskId }));
        u.contracts.insert(contract);
      });
      const v2 = { ...contract, version: 2, updatedAt: "2026-08-14T01:00:00.000Z" };
      uow.commit((u) => {
        u.contracts.addVersion(project.projectId, v2, 1, "task re-opened after scope change");
      });
      expect(uow.contracts.getRevisionReason(project.projectId, contract.contractId, 2)).toBe(
        "task re-opened after scope change",
      );
      expect(uow.contracts.getRevisionReason(project.projectId, contract.contractId, 1)).toBeUndefined();
    });
  });

  describe("association event append (docs/30 §5)", () => {
    function makeAssociationEvent(
      projectId: string,
      taskId: string,
      sessionId: string,
      payloadHash: string,
    ): StandardEvent {
      return {
        schemaVersion: "1.0.0",
        eventId: generateId(),
        idempotencyKey: generateId(),
        eventType: "session_attachment",
        host: "codex",
        projectId,
        taskId,
        sessionId,
        occurredAt: "2026-08-14T00:00:00.000Z",
        receivedAt: "2026-08-14T00:00:00.000Z",
        bypass: false,
        privacyClass: "internal",
        rawPayloadHash: payloadHash,
      };
    }

    it("appends without a lease, replays idempotently, and rejects payload reuse", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task = makeTask(project.projectId);
      const session = makeSession({ taskId: task.taskId });
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task);
        u.sessions.insert(project.projectId, session);
      });
      const event = makeAssociationEvent(project.projectId, task.taskId, session.sessionId, "a".repeat(64));
      uow.commit((u) => {
        u.events.appendAssociation(event);
      });
      expect(uow.events.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);

      // Replaying the exact same association is a no-op.
      uow.commit((u) => {
        u.events.appendAssociation(event);
      });
      expect(uow.events.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(1);

      // The same idempotency key with different payload/scope is a violation.
      const conflicting = { ...event, eventId: generateId(), rawPayloadHash: "b".repeat(64) };
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.events.appendAssociation(conflicting);
        });
      }, SestinaErrorCode.idempotency_violation);
    });

    it("never creates a lease row and reserve refuses association events", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task = makeTask(project.projectId);
      const session = makeSession({ taskId: task.taskId });
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task);
        u.sessions.insert(project.projectId, session);
      });
      const event = makeAssociationEvent(project.projectId, task.taskId, session.sessionId, "a".repeat(64));
      uow.commit((u) => {
        u.events.appendAssociation(event);
      });
      // The judge pipeline enters events only through reserve/leases; an
      // association event must have no lease row (docs/30 §5).
      const leaseCount = (): number => {
        const row = db.get<{ c: number | bigint }>(
          "SELECT COUNT(*) AS c FROM event_leases WHERE idempotency_key = ?",
          event.idempotencyKey,
        );
        return Number(row?.c ?? 0);
      };
      expect(leaseCount()).toBe(0);
      // And reserve must refuse to give it one, keeping the boundary.
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.events.reserve(event, { ownerId: "judge" });
        });
      }, SestinaErrorCode.validation_failed);
      expect(leaseCount()).toBe(0);
      // Replay stays lease-free too.
      uow.commit((u) => {
        u.events.appendAssociation(event);
      });
      expect(leaseCount()).toBe(0);
    });

    it("refuses governed event types through the association append path", () => {
      const uow = createUnitOfWork(db);
      const project = makeProject();
      const task = makeTask(project.projectId);
      const session = makeSession({ taskId: task.taskId });
      uow.commit((u) => {
        u.projects.insert(project);
        u.tasks.insert(task);
        u.sessions.insert(project.projectId, session);
      });
      const governed = {
        ...makeAssociationEvent(project.projectId, task.taskId, session.sessionId, "a".repeat(64)),
        eventType: "stop",
      } as StandardEvent;
      expectSestinaCode(() => {
        uow.commit((u) => {
          u.events.appendAssociation(governed);
        });
      }, SestinaErrorCode.validation_failed);
      // Nothing was appended through the wrong path.
      expect(uow.events.listByProject(project.projectId, { limit: 10 }).items).toHaveLength(0);
    });
  });
});
