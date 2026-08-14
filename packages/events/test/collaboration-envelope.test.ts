import { describe, expect, it } from "vitest";
import {
  normalizeCollaborationEnvelope,
  type Result,
} from "../src/index.js";

const PROJECT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TASK = "01ARZ3NDEKTSV4RRFFQ69G5FBB";
const THREAD = "01ARZ3NDEKTSV4RRFFQ69G5FCC";
const SOURCE_ENDPOINT = "01ARZ3NDEKTSV4RRFFQ69G5FDD";
const TARGET_ENDPOINT = "01ARZ3NDEKTSV4RRFFQ69G5FEE";
const MESSAGE = "01ARZ3NDEKTSV4RRFFQ69G5FFF";
const ATTEMPT = "01ARZ3NDEKTSV4RRFFQ69G5FGG";
const ACTION = "01ARZ3NDEKTSV4RRFFQ69G5FHH";

function expectOk<T>(result: Result<T>): T {
  expect(
    result.ok,
    `expected ok, got: ${JSON.stringify(!result.ok ? result.error.toJSON() : null)}`,
  ).toBe(true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

const validMessage = {
  messageId: MESSAGE,
  threadId: THREAD,
  projectId: PROJECT,
  taskId: TASK,
  kind: "status",
  sourceEndpointId: SOURCE_ENDPOINT,
  targetEndpointIds: [TARGET_ENDPOINT],
  summary: "Refactor complete, tests green",
  constraints: [],
  evidenceRefs: [],
  contextRefs: [],
  authority: {
    actor: "peer_agent",
    directUser: false,
    sourceHost: "codex",
    sourceSessionId: "codex-sess-0001",
    contractVersion: 3,
    allowedOutcome: "inform",
  },
  privacyClass: "internal",
  ttlSeconds: 1800,
  hopCount: 0,
  dedupeKey: "dedupe-001",
  createdAt: "2026-08-14T10:00:00.000Z",
  expiresAt: "2026-08-14T10:30:00.000Z",
};

const validAttempt = {
  attemptId: ATTEMPT,
  messageId: MESSAGE,
  targetEndpointId: TARGET_ENDPOINT,
  sequence: 1,
  route: "ws://127.0.0.1:4500",
  status: "delivered",
  startedAt: "2026-08-14T10:00:01.000Z",
  finishedAt: "2026-08-14T10:00:01.500Z",
};

const validAction = {
  actionId: ACTION,
  messageId: MESSAGE,
  endpointId: TARGET_ENDPOINT,
  status: "accepted",
  actedAt: "2026-08-14T10:01:00.000Z",
};

/**
 * Collaboration envelope spec.
 *
 * normalizeCollaborationEnvelope maps the collaboration wire objects defined
 * in packages/schema/src/collaboration.ts onto StandardEvent:
 *   CollaborationMessage          → collaboration_message
 *   CollaborationDeliveryAttempt  → collaboration_delivery
 *   CollaborationAction           → collaboration_action
 * The envelope's own projectId/taskId (validated ULIDs) are preserved, the
 * message's privacyClass is carried through, and the host defaults to
 * "service" (the local collaboration relay) unless overridden.
 */
describe("normalizeCollaborationEnvelope", () => {
  it("maps a collaboration message to collaboration_message", async () => {
    const event = expectOk(await normalizeCollaborationEnvelope(validMessage));
    expect(event.eventType).toBe("collaboration_message");
    expect(event.host).toBe("service");
    expect(event.projectId).toBe(PROJECT);
    expect(event.taskId).toBe(TASK);
    expect(event.privacyClass).toBe("internal");
    expect(event.bypass).toBe(false);
    expect(event.occurredAt).toBe(validMessage.createdAt);
    expect(event.action?.category).toBe("message");
    expect(event.action?.reversible).toBe(true);
    expect(event.action?.external).toBe(false);
    expect(event.content?.hasOutput).toBe(true);
    expect(event.sourceCapability).toBe("collaboration");
  });

  it("accepts an explicit host override", async () => {
    const event = expectOk(
      await normalizeCollaborationEnvelope(validMessage, { host: "desktop" }),
    );
    expect(event.host).toBe("desktop");
  });

  it("maps a delivery attempt to collaboration_delivery", async () => {
    const event = expectOk(await normalizeCollaborationEnvelope(validAttempt));
    expect(event.eventType).toBe("collaboration_delivery");
    expect(event.action).toBeUndefined();
    expect(event.occurredAt).toBe(validAttempt.startedAt);
    expect(event.privacyClass).toBe("internal");
  });

  it("maps a processing action to collaboration_action", async () => {
    const event = expectOk(await normalizeCollaborationEnvelope(validAction));
    expect(event.eventType).toBe("collaboration_action");
    expect(event.occurredAt).toBe(validAction.actedAt);
    expect(event.action?.toolName).toBe("collaboration_action");
    expect(event.action?.category).toBe("message");
  });

  it("derives distinct keys for message, delivery and action of one message", async () => {
    const message = expectOk(await normalizeCollaborationEnvelope(validMessage));
    const delivery = expectOk(await normalizeCollaborationEnvelope(validAttempt));
    const action = expectOk(await normalizeCollaborationEnvelope(validAction));
    expect(message.idempotencyKey).not.toBe(delivery.idempotencyKey);
    expect(delivery.idempotencyKey).not.toBe(action.idempotencyKey);
  });

  it("is deterministic for the same envelope", async () => {
    const first = expectOk(await normalizeCollaborationEnvelope(validMessage));
    const second = expectOk(await normalizeCollaborationEnvelope(validMessage));
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.eventId).not.toBe(second.eventId);
  });

  it("rejects malformed envelopes with validation_failed", async () => {
    for (const raw of [
      { notAnEnvelope: true },
      { ...validMessage, projectId: "not-a-ulid" },
      "a string",
      null,
    ]) {
      const result = await normalizeCollaborationEnvelope(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation_failed");
      }
    }
  });
});
