import {
  EventIdSchema,
  generateId,
  ProjectIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  type Host,
  type StandardEvent,
} from "@sestina/schema";
import { sha256 } from "@sestina/storage";

// ── Association events (docs/30 §5 "写关联事件") ──
// Every attach/detach relationship change appends a `session_attachment`
// event. The idempotency key is a stable composite of the relationship and
// its confirmation time, so a crash retry of the same change replays as a
// no-op while two distinct changes never collide. The rawPayloadHash is the
// sha256 of the canonical payload JSON — the digest is what identity checks
// compare, never free text.

export interface AttachmentAssociationInput {
  host: Host;
  projectId: string;
  taskId: string;
  sessionId: string;
  action: "attach" | "detach";
  occurredAt: string;
  reason?: string;
}

export function buildAttachmentAssociationEvent(
  input: AttachmentAssociationInput,
): StandardEvent {
  const idempotencyKey =
    `session-attachment:${input.action}:${input.sessionId}:${input.taskId}:${input.occurredAt}`;
  const payload = {
    action: input.action,
    sessionId: input.sessionId,
    projectId: input.projectId,
    taskId: input.taskId,
    reason: input.reason,
    occurredAt: input.occurredAt,
  };
  return {
    schemaVersion: "1.0.0",
    // Branded ids via runtime-validated parse (events package idiom).
    eventId: EventIdSchema.parse(generateId()),
    idempotencyKey,
    eventType: "session_attachment",
    host: input.host,
    projectId: ProjectIdSchema.parse(input.projectId),
    taskId: TaskIdSchema.parse(input.taskId),
    sessionId: SessionIdSchema.parse(input.sessionId),
    occurredAt: input.occurredAt,
    receivedAt: input.occurredAt,
    bypass: false,
    privacyClass: "internal",
    rawPayloadHash: sha256(JSON.stringify(payload)),
  };
}
