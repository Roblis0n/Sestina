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
 * carry no project/task identity of their own, and the normalizer NEVER
 * fabricates one: the caller must resolve the real owner of the referenced
 * message (docs/42 §8: the message row exists before its attempts) and pass
 * it as validated options.projectId/taskId, or inject a resolveOwner lookup.
 * An attempt/action envelope without a resolved owner is rejected
 * (validation_failed) — a deterministic stand-in would split one message's
 * lifecycle across a real project and a fake one.
 *
 * The host defaults to "service" — envelopes arrive through the local
 * collaboration relay, not a code host.
 */
export interface NormalizeCollaborationEnvelopeOptions {
  host?: "desktop" | "service" | "cli";
  /** Both or neither: the real owner of the referenced message. */
  projectId?: string;
  taskId?: string;
  /** Owner lookup for the referenced message (e.g. the relay's message row). */
  resolveOwner?: (
    messageId: string,
  ) =>
    | { projectId: string; taskId: string }
    | Promise<{ projectId: string; taskId: string } | undefined>
    | undefined;
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
      const [projectId, taskId] = await resolveProjectTask(
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
      const [projectId, taskId] = await resolveProjectTask(
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

/**
 * Resolve the real owner of the referenced message for attempt/action
 * envelopes. Options carry it directly (both validated ids together) or
 * the caller injects a lookup. Absent owner is rejected, never invented.
 */
async function resolveProjectTask(
  messageId: string,
  options: NormalizeCollaborationEnvelopeOptions,
): Promise<[ProjectId, TaskId]> {
  if (options.projectId !== undefined || options.taskId !== undefined) {
    if (options.projectId === undefined || options.taskId === undefined) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "projectId and taskId must be provided together",
        undefined,
        { reason: "collaboration_owner_partial" },
      );
    }
    return [
      parseOwnerId(ProjectIdSchema, options.projectId),
      parseOwnerId(TaskIdSchema, options.taskId),
    ];
  }
  if (options.resolveOwner !== undefined) {
    const owner = await options.resolveOwner(messageId);
    if (owner !== undefined) {
      return [
        parseOwnerId(ProjectIdSchema, owner.projectId),
        parseOwnerId(TaskIdSchema, owner.taskId),
      ];
    }
  }
  throw new SestinaError(
    SestinaErrorCode.validation_failed,
    "collaboration delivery/action envelope requires a resolved project/task owner",
    undefined,
    { reason: "collaboration_owner_required" },
  );
}

function parseOwnerId<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "invalid project/task owner in collaboration envelope options",
      undefined,
      { reason: "invalid_owner_id" },
    );
  }
  return parsed.data;
}

function ok(event: StandardEvent): Result<StandardEvent> {
  return { ok: true, value: event };
}
