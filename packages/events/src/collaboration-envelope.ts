import {
  CollaborationActionSchema,
  CollaborationDeliveryAttemptSchema,
  CollaborationMessageSchema,
  EventIdSchema,
  ProjectIdSchema,
  SessionIdSchema,
  SestinaError,
  SestinaErrorCode,
  TaskIdSchema,
  generateId,
  isSestinaError,
  nowUTC,
  type ActionDescriptor,
  type Host,
  type ProjectId,
  type StandardEvent,
  type TaskId,
} from "@sestina/schema";
import {
  buildIdempotencyKey,
  deriveDeterministicId,
  sha256Hex,
} from "./idempotency.js";
import { enforceRawEventLimits } from "./limits.js";
import type { Result } from "./normalize.js";

/**
 * Collaboration envelope normalization.
 *
 * Maps the collaboration wire objects defined in packages/schema (docs/42)
 * onto StandardEvent:
 *   CollaborationMessage         -> collaboration_message
 *   CollaborationDeliveryAttempt -> collaboration_delivery
 *   CollaborationAction          -> collaboration_action
 *
 * The message carries its own projectId/taskId/privacyClass (validated
 * ULIDs) and they are preserved. Delivery attempts and processing actions
 * carry no project/task identity: callers should pass the real ids via
 * options; otherwise a deterministic stand-in derived from the messageId is used (the same
 * honesty rule as host events — Task 8 re-binds).
 *
 * The host defaults to "service" — envelopes arrive through the local
 * collaboration relay, not a code host.
 */
export interface NormalizeCollaborationEnvelopeOptions {
  host?: "desktop" | "service" | "cli";
  projectId?: string;
  taskId?: string;
}

const MESSAGE_ACTION: ActionDescriptor = {
  toolName: "collaboration_message",
  category: "message",
  reversible: true,
  external: false,
  resourceRefs: [],
};

export async function normalizeCollaborationEnvelope(
  raw: unknown,
  options: NormalizeCollaborationEnvelopeOptions = {},
): Promise<Result<StandardEvent>> {
  try {
    // The same raw-size gate as host events runs before any parsing — an
    // unbounded envelope is never stringified and hashed blindly.
    const limited = enforceRawEventLimits(raw, undefined);
    const bytes = limited.bytes;
    const host: Host = options.host ?? "service";
    const rawPayloadHash = await sha256Hex(bytes);

    const message = CollaborationMessageSchema.safeParse(raw);
    if (message.success) {
      const data = message.data;
      const sessionId = SessionIdSchema.parse(
        await deriveDeterministicId(
          "session",
          `collaboration\u0000${data.sourceEndpointId}`,
        ),
      );
      const idempotencyKey = await buildIdempotencyKey({
        host,
        sessionId,
        projectId: data.projectId,
        nativeEventName: "collaboration_message",
        phase: "lifecycle",
        discriminator: data.messageId,
      });
      return ok({
        schemaVersion: "1.0.0",
        eventId: EventIdSchema.parse(generateId()),
        idempotencyKey,
        eventType: "collaboration_message",
        host,
        projectId: data.projectId,
        taskId: data.taskId,
        sessionId,
        action: MESSAGE_ACTION,
        content: {
          hasPrompt: false,
          hasFiles: false,
          hasOutput: true,
          outputLength: data.summary.length,
          totalChars: data.summary.length,
        },
        occurredAt: data.createdAt,
        receivedAt: nowUTC(),
        bypass: false,
        // The sender-declared privacy class is not trusted for the persisted
        // event: even "public" envelopes are clamped to internal until the
        // judge re-classifies them (Task 8) — honest by default.
        privacyClass:
          data.privacyClass === "public" ? "internal" : data.privacyClass,
        rawPayloadHash,
        sourceCapability: "collaboration",
      });
    }

    const attempt = CollaborationDeliveryAttemptSchema.safeParse(raw);
    if (attempt.success) {
      const data = attempt.data;
      const [projectId, taskId] = await derivedProjectTask(
        data.messageId,
        options,
      );
      const sessionId = SessionIdSchema.parse(
        await deriveDeterministicId(
          "session",
          `collaboration\u0000${data.targetEndpointId}`,
        ),
      );
      const idempotencyKey = await buildIdempotencyKey({
        host,
        sessionId,
        projectId,
        nativeEventName: "collaboration_delivery",
        phase: "lifecycle",
        discriminator: data.attemptId,
      });
      return ok({
        schemaVersion: "1.0.0",
        eventId: EventIdSchema.parse(generateId()),
        idempotencyKey,
        eventType: "collaboration_delivery",
        host,
        projectId,
        taskId,
        sessionId,
        occurredAt: data.startedAt,
        receivedAt: nowUTC(),
        bypass: false,
        privacyClass: "internal",
        rawPayloadHash,
        sourceCapability: "collaboration",
      });
    }

    const action = CollaborationActionSchema.safeParse(raw);
    if (action.success) {
      const data = action.data;
      const [projectId, taskId] = await derivedProjectTask(
        data.messageId,
        options,
      );
      const sessionId = SessionIdSchema.parse(
        await deriveDeterministicId(
          "session",
          `collaboration\u0000${data.endpointId}`,
        ),
      );
      const idempotencyKey = await buildIdempotencyKey({
        host,
        sessionId,
        projectId,
        nativeEventName: "collaboration_action",
        phase: "lifecycle",
        discriminator: data.actionId,
      });
      return ok({
        schemaVersion: "1.0.0",
        eventId: EventIdSchema.parse(generateId()),
        idempotencyKey,
        eventType: "collaboration_action",
        host,
        projectId,
        taskId,
        sessionId,
        action: {
          toolName: "collaboration_action",
          category: "message",
          reversible: true,
          external: false,
          resourceRefs: [],
        },
        occurredAt: data.actedAt,
        receivedAt: nowUTC(),
        bypass: false,
        privacyClass: "internal",
        rawPayloadHash,
        sourceCapability: "collaboration",
      });
    }

    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "raw input is not a collaboration message, delivery attempt, or processing action",
      undefined,
      { received: typeof raw },
    );
  } catch (error) {
    if (isSestinaError(error)) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: new SestinaError(
        SestinaErrorCode.internal_error,
        "unexpected collaboration envelope failure",
      ),
    };
  }
}

async function derivedProjectTask(
  messageId: string,
  options: NormalizeCollaborationEnvelopeOptions,
): Promise<[ProjectId, TaskId]> {
  const projectId =
    options.projectId !== undefined
      ? ProjectIdSchema.parse(options.projectId)
      : ProjectIdSchema.parse(
          await deriveDeterministicId("project", `collaboration\u0000${messageId}`),
        );
  const taskId =
    options.taskId !== undefined
      ? TaskIdSchema.parse(options.taskId)
      : TaskIdSchema.parse(
          await deriveDeterministicId("task", `collaboration\u0000${messageId}`),
        );
  return [projectId, taskId];
}

function ok(event: StandardEvent): Result<StandardEvent> {
  return { ok: true, value: event };
}
