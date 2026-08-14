import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateId } from "@sestina/schema";
import { deriveDeterministicId, hostIdentityInput } from "@sestina/events";
import type { StorageDatabase } from "@sestina/storage";
import { createCollaborationEndpointService } from "../src/index.js";
import {
  makeTempDir,
  removeTempDir,
  makeDb,
  makeProject,
  makeTask,
  makeSession,
  seed,
  expectSestinaCode,
  expectSestinaCodeAsync,
  T0,
  T1,
} from "./helpers.js";

describe("collaboration endpoints (docs/30 §8)", () => {
  let dir: string;
  let db: StorageDatabase;
  let project: ReturnType<typeof makeProject>;
  let task: ReturnType<typeof makeTask>;
  let otherTask: ReturnType<typeof makeTask>;
  let session: ReturnType<typeof makeSession>;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await makeDb(dir);
    project = makeProject();
    task = makeTask(project.projectId, { status: "active" });
    otherTask = makeTask(project.projectId, { status: "active" });
    session = makeSession({ taskId: task.taskId });
    seed(db, (u) => {
      u.projects.insert(project);
      u.tasks.insert(task);
      u.tasks.insert(otherTask);
      u.sessions.insert(project.projectId, session);
      u.sessionAttachments.insert({
        attachmentId: generateId(),
        sessionId: session.sessionId,
        projectId: project.projectId,
        taskId: task.taskId,
        attachedAt: T0,
      });
    });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("registers an endpoint with a deterministic id for the confirmed session", async () => {
    const endpoints = createCollaborationEndpointService(db);
    const endpoint = await endpoints.register({
      host: session.host,
      hostSessionId: session.hostSessionId,
      projectId: project.projectId,
      taskId: task.taskId,
      capability: "realtime",
      transportIds: ["mcp"],
    });
    expect(endpoint.endpointId).toBe(
      await deriveDeterministicId("endpoint", hostIdentityInput(session.host, session.hostSessionId)),
    );
    expect(endpoint.capability).toBe("realtime");
    expect(endpoint.connected).toBe(true);
    expect(endpoints.listForTask(project.projectId, task.taskId).map((e) => e.endpointId)).toEqual([
      endpoint.endpointId,
    ]);
  });

  it("treats a re-register as an idempotent handshake update", async () => {
    const endpoints = createCollaborationEndpointService(db);
    const first = await endpoints.register({
      host: session.host,
      hostSessionId: session.hostSessionId,
      projectId: project.projectId,
      taskId: task.taskId,
      capability: "next_turn",
    });
    const second = await endpoints.register({
      host: session.host,
      hostSessionId: session.hostSessionId,
      projectId: project.projectId,
      taskId: task.taskId,
      capability: "realtime",
    });
    expect(second.endpointId).toBe(first.endpointId);
    expect(endpoints.listForTask(project.projectId, task.taskId)).toHaveLength(1);
    expect(endpoints.get(project.projectId, first.endpointId)?.capability).toBe("realtime");
  });

  it("refuses endpoints for unknown or unattached sessions", async () => {
    const endpoints = createCollaborationEndpointService(db);
    await expectSestinaCodeAsync(
      () =>
        endpoints.register({
          host: "codex",
          hostSessionId: "never-started",
          projectId: project.projectId,
          taskId: task.taskId,
          capability: "queued",
        }),
      "validation_failed",
    );
    // The session exists but is attached to another task.
    await expectSestinaCodeAsync(
      () =>
        endpoints.register({
          host: session.host,
          hostSessionId: session.hostSessionId,
          projectId: project.projectId,
          taskId: otherTask.taskId,
          capability: "queued",
        }),
      "validation_failed",
    );
  });

  it("refuses endpoints for sessions of another project", async () => {
    const endpoints = createCollaborationEndpointService(db);
    const otherProject = makeProject();
    seed(db, (u) => {
      u.projects.insert(otherProject);
    });
    await expectSestinaCodeAsync(
      () =>
        endpoints.register({
          host: session.host,
          hostSessionId: session.hostSessionId,
          projectId: otherProject.projectId,
          taskId: task.taskId,
          capability: "queued",
        }),
      "validation_failed",
    );
  });

  it("updates capability on handshake with compare-and-swap", async () => {
    const endpoints = createCollaborationEndpointService(db);
    const registered = await endpoints.register({
      host: session.host,
      hostSessionId: session.hostSessionId,
      projectId: project.projectId,
      taskId: task.taskId,
      capability: "next_turn",
    });
    endpoints.onHandshake(project.projectId, registered.endpointId, "realtime", {
      expectedCapability: "next_turn",
      at: T1,
    });
    const updated = endpoints.get(project.projectId, registered.endpointId);
    expect(updated?.capability).toBe("realtime");
    expect(updated?.lastSeenAt).toBe(T1);
    expect(updated?.connected).toBe(true);

    // A racer with a stale expectation loses the compare-and-swap.
    expectSestinaCode(
      () => {
        endpoints.onHandshake(project.projectId, registered.endpointId, "queued", {
          expectedCapability: "next_turn",
        });
      },
      "stale_state",
    );
    expect(endpoints.get(project.projectId, registered.endpointId)?.capability).toBe("realtime");

    expectSestinaCode(
      () => {
        endpoints.onHandshake(project.projectId, generateId(), "realtime", {
          expectedCapability: "next_turn",
        });
      },
      "collaboration_endpoint_not_found",
    );
  });

  it("sets the inbound policy with an optional capability guard", async () => {
    const endpoints = createCollaborationEndpointService(db);
    const registered = await endpoints.register({
      host: session.host,
      hostSessionId: session.hostSessionId,
      projectId: project.projectId,
      taskId: task.taskId,
      capability: "realtime",
    });
    endpoints.setInboundPolicy(project.projectId, registered.endpointId, "hold", {
      expectedCapability: "realtime",
    });
    expect(endpoints.get(project.projectId, registered.endpointId)?.inboundPolicy).toBe("hold");

    expectSestinaCode(
      () => {
        endpoints.setInboundPolicy(project.projectId, registered.endpointId, "accept", {
          expectedCapability: "next_turn",
        });
      },
      "stale_state",
    );
  });
});
