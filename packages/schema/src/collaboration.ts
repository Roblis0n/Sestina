import { z } from "zod";
import { ID_SCHEMA, ProjectIdSchema, TaskIdSchema } from "./ids.js";
import { PRIVACY_CLASS_SCHEMA, TimestampSchema } from "./common.js";
import { ContextRefSchema, type ContextRef } from "./conversations.js";
import { SestinaError, SestinaErrorCode } from "./errors.js";

// ── Limits (docs/42 §11.2; schema is the absolute ceiling, config can only tighten) ──
export const COLLABORATION_LIMITS = {
  maxHops: 4,
  maxOutstandingConsultsPerTask: 8,
  maxMessagesPerMinutePerTask: 12,
  maxMessageBytes: 16384, // 16 KiB per message
  maxContextRefs: 8,
  defaultTtlSeconds: 1800,
  maxTtlSeconds: 86400,
  messageRetentionDays: 90,
} as const;

// ── IDs (docs/09 §3: ULID-based collaboration identifiers) ──
export const CollaborationThreadIdSchema = ID_SCHEMA.brand("CollaborationThreadId");
export type CollaborationThreadId = z.infer<typeof CollaborationThreadIdSchema>;

export const CollaborationMessageIdSchema = ID_SCHEMA.brand("CollaborationMessageId");
export type CollaborationMessageId = z.infer<typeof CollaborationMessageIdSchema>;

export const CollaborationEndpointIdSchema = ID_SCHEMA.brand("CollaborationEndpointId");
export type CollaborationEndpointId = z.infer<typeof CollaborationEndpointIdSchema>;

export const CollaborationAttemptIdSchema = ID_SCHEMA.brand("CollaborationAttemptId");
export type CollaborationAttemptId = z.infer<typeof CollaborationAttemptIdSchema>;

export const CollaborationActionIdSchema = ID_SCHEMA.brand("CollaborationActionId");
export type CollaborationActionId = z.infer<typeof CollaborationActionIdSchema>;

// ── Enums (docs/42 §5) ──
export const CollaborationMessageKindSchema = z.enum([
  "status",
  "consult",
  "reply",
  "handoff",
]);
export type CollaborationMessageKind = z.infer<typeof CollaborationMessageKindSchema>;

export const CollaborationThreadStatusSchema = z.enum([
  "active",
  "resolved",
  "archived",
]);
export type CollaborationThreadStatus = z.infer<typeof CollaborationThreadStatusSchema>;

export const CollaborationCreatedBySchema = z.enum(["user", "agent", "system"]);
export type CollaborationCreatedBy = z.infer<typeof CollaborationCreatedBySchema>;

export const CollaborationHostSchema = z.enum(["codex", "claude_code"]);
export type CollaborationHost = z.infer<typeof CollaborationHostSchema>;

export const CollaborationCapabilitySchema = z.enum([
  "realtime",
  "next_turn",
  "queued",
  "unreachable",
]);
export type CollaborationCapability = z.infer<typeof CollaborationCapabilitySchema>;

export const CollaborationInboundPolicySchema = z.enum(["accept", "hold", "refuse"]);
export type CollaborationInboundPolicy = z.infer<typeof CollaborationInboundPolicySchema>;

export const CollaborationDeliveryStatusSchema = z.enum([
  "queued",
  "delivered",
  "held",
  "refused",
  "expired",
  "unreachable",
  "failed",
  "cancelled",
]);
export type CollaborationDeliveryStatus = z.infer<typeof CollaborationDeliveryStatusSchema>;

export const CollaborationProcessingStatusSchema = z.enum([
  "unread",
  "acknowledged",
  "accepted",
  "declined",
  "completed",
]);
export type CollaborationProcessingStatus = z.infer<typeof CollaborationProcessingStatusSchema>;

export const CollaborationAllowedOutcomeSchema = z.enum([
  "inform",
  "answer",
  "perform_scoped_handoff",
]);
export type CollaborationAllowedOutcome = z.infer<typeof CollaborationAllowedOutcomeSchema>;

// ── Authority (docs/42 §5.3): peers can never be direct users ──
export const CollaborationAuthoritySchema = z.object({
  actor: z.literal("peer_agent"),
  directUser: z.literal(false),
  sourceHost: CollaborationHostSchema,
  sourceSessionId: z.string().min(1).max(256),
  contractVersion: z.number().int().nonnegative(),
  preauthorizationId: z.string().min(1).max(128).optional(),
  userConfirmationId: z.string().min(1).max(128).optional(),
  allowedOutcome: CollaborationAllowedOutcomeSchema,
});
export type CollaborationAuthority = z.infer<typeof CollaborationAuthoritySchema>;

// ── Thread (docs/42 §5.2) ──
export const CollaborationThreadSchema = z.object({
  threadId: CollaborationThreadIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  title: z.string().min(1).max(500),
  participantEndpointIds: z.array(CollaborationEndpointIdSchema).max(32),
  status: CollaborationThreadStatusSchema,
  createdBy: CollaborationCreatedBySchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type CollaborationThread = z.infer<typeof CollaborationThreadSchema>;

// ── Endpoint (docs/42 §5.4) ──
export const CollaborationEndpointSchema = z.object({
  endpointId: CollaborationEndpointIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  host: CollaborationHostSchema,
  hostSessionId: z.string().min(1).max(256),
  capability: CollaborationCapabilitySchema,
  transportIds: z.array(z.string().min(1).max(128)).max(16),
  inboundPolicy: CollaborationInboundPolicySchema,
  connected: z.boolean(),
  lastSeenAt: TimestampSchema.optional(),
});
export type CollaborationEndpoint = z.infer<typeof CollaborationEndpointSchema>;

// ── Message (docs/42 §5.3, docs/09 §23) ──

/** UTF-8 byte size of the message's textual payload (used by the 16 KiB cap). */
export function collaborationMessageTextBytes(message: {
  summary: string;
  body?: string;
  constraints: string[];
  evidenceRefs: string[];
  contextRefs: readonly { refId: string }[];
  requestedOutcome?: string;
}): number {
  const parts = [
    message.summary,
    message.body ?? "",
    message.requestedOutcome ?? "",
    ...message.constraints,
    ...message.evidenceRefs,
    ...message.contextRefs.map((ref) => ref.refId),
  ];
  return parts.reduce((total, part) => total + Buffer.byteLength(part, "utf8"), 0);
}

export const CollaborationMessageSchema = z.object({
  messageId: CollaborationMessageIdSchema,
  threadId: CollaborationThreadIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  kind: CollaborationMessageKindSchema,
  sourceEndpointId: CollaborationEndpointIdSchema,
  targetEndpointIds: z.array(CollaborationEndpointIdSchema).min(1).max(32),
  replyToMessageId: CollaborationMessageIdSchema.optional(),
  summary: z.string().min(1).max(COLLABORATION_LIMITS.maxMessageBytes),
  body: z.string().max(COLLABORATION_LIMITS.maxMessageBytes).optional(),
  constraints: z.array(z.string().min(1).max(500)).max(32),
  evidenceRefs: z.array(z.string().min(1).max(128)).max(64),
  contextRefs: z.array(ContextRefSchema).max(COLLABORATION_LIMITS.maxContextRefs),
  requestedOutcome: z.string().min(1).max(2000).optional(),
  authority: CollaborationAuthoritySchema,
  privacyClass: PRIVACY_CLASS_SCHEMA,
  ttlSeconds: z
    .number()
    .int()
    .min(1)
    .max(COLLABORATION_LIMITS.maxTtlSeconds)
    .default(COLLABORATION_LIMITS.defaultTtlSeconds),
  hopCount: z.number().int().min(0).max(COLLABORATION_LIMITS.maxHops),
  dedupeKey: z.string().min(1).max(128),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).superRefine((data, ctx) => {
  // Each message is at most 16 KiB in total (docs/42 §12).
  if (collaborationMessageTextBytes(data) > COLLABORATION_LIMITS.maxMessageBytes) {
    ctx.addIssue({
      code: "custom",
      message: `Message text exceeds the ${COLLABORATION_LIMITS.maxMessageBytes}-byte limit`,
      path: ["summary"],
    });
  }
});
export type CollaborationMessage = z.infer<typeof CollaborationMessageSchema>;

// ── Delivery attempt (docs/09 §23): append-only ──
export const CollaborationDeliveryAttemptSchema = z.object({
  attemptId: CollaborationAttemptIdSchema,
  messageId: CollaborationMessageIdSchema,
  targetEndpointId: CollaborationEndpointIdSchema,
  sequence: z.number().int().min(1),
  route: z.string().min(1).max(256),
  status: CollaborationDeliveryStatusSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.optional(),
  adapterReceipt: z.string().max(512).optional(),
  error: z.string().max(500).optional(),
});
export type CollaborationDeliveryAttempt = z.infer<typeof CollaborationDeliveryAttemptSchema>;

// ── Processing action (docs/42 §7.2): delivered ≠ accepted/completed ──
export const CollaborationActionSchema = z.object({
  actionId: CollaborationActionIdSchema,
  messageId: CollaborationMessageIdSchema,
  endpointId: CollaborationEndpointIdSchema,
  status: CollaborationProcessingStatusSchema,
  actedAt: TimestampSchema,
  note: z.string().max(500).optional(),
});
export type CollaborationAction = z.infer<typeof CollaborationActionSchema>;

// ── Collaboration config (docs/42 §11.2, docs/16 §4) ──
export const CollaborationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sameProjectOnly: z.boolean().default(true),
  allowRemoteTransport: z.boolean().default(false),
  defaultInboundPolicy: CollaborationInboundPolicySchema.default("accept"),
  handoffRequiresUserConfirmation: z.boolean().default(true),
  maxHops: z.number().int().min(1).max(COLLABORATION_LIMITS.maxHops).default(COLLABORATION_LIMITS.maxHops),
  maxOutstandingConsultsPerTask: z
    .number()
    .int()
    .min(1)
    .default(COLLABORATION_LIMITS.maxOutstandingConsultsPerTask),
  maxMessagesPerMinutePerTask: z
    .number()
    .int()
    .min(1)
    .default(COLLABORATION_LIMITS.maxMessagesPerMinutePerTask),
  maxMessageBytes: z
    .number()
    .int()
    .min(1)
    .max(COLLABORATION_LIMITS.maxMessageBytes)
    .default(COLLABORATION_LIMITS.maxMessageBytes),
  maxContextRefs: z
    .number()
    .int()
    .min(1)
    .max(COLLABORATION_LIMITS.maxContextRefs)
    .default(COLLABORATION_LIMITS.maxContextRefs),
  defaultTtlSeconds: z
    .number()
    .int()
    .min(1)
    .default(COLLABORATION_LIMITS.defaultTtlSeconds),
  maxTtlSeconds: z
    .number()
    .int()
    .min(1)
    .max(COLLABORATION_LIMITS.maxTtlSeconds)
    .default(COLLABORATION_LIMITS.maxTtlSeconds),
  messageRetentionDays: z
    .number()
    .int()
    .min(1)
    .default(COLLABORATION_LIMITS.messageRetentionDays),
}).superRefine((data, ctx) => {
  if (data.defaultTtlSeconds > data.maxTtlSeconds) {
    ctx.addIssue({
      code: "custom",
      message: "defaultTtlSeconds must not exceed maxTtlSeconds",
      path: ["defaultTtlSeconds"],
    });
  }
});
export type CollaborationConfig = z.infer<typeof CollaborationConfigSchema>;

// ── Ownership checks (docs/42 §6.2, docs/09 §16/§23) ──

export interface CollaborationOwnershipContext {
  /** The thread the message claims to belong to. */
  thread: CollaborationThread;
  /**
   * Known endpoint bindings. When provided, every source/target endpoint
   * must be bound to the message's projectId/taskId.
   */
  endpointProjects?: ReadonlyMap<string, { projectId: string; taskId: string }>;
  /**
   * Known project owners of referenced objects (evidence/claims/decisions/...).
   * When provided, every ContextRef/evidenceRef must resolve inside the
   * message's project. A map without an entry means "not resolvable".
   */
  refOwnerProjects?: ReadonlyMap<string, string>;
}

/**
 * Rejects messages whose thread/project/task/endpoint/ref ownership is
 * inconsistent. Cross-project and cross-task references are always rejected
 * (docs/42 §6.2 condition 2; docs/09 §23).
 */
export function assertCollaborationOwnership(
  message: CollaborationMessage,
  context: CollaborationOwnershipContext,
): void {
  const reject = (detail: string): never => {
    throw new SestinaError(
      SestinaErrorCode.project_mismatch,
      "Collaboration message ownership check failed",
      undefined,
      detail,
    );
  };

  const { thread } = context;
  if (message.threadId !== thread.threadId) {
    reject("message.threadId does not match the thread");
  }
  if (message.projectId !== thread.projectId) {
    reject("message.projectId does not match the thread project");
  }
  if (message.taskId !== thread.taskId) {
    reject("message.taskId does not match the thread task");
  }
  if (!thread.participantEndpointIds.includes(message.sourceEndpointId)) {
    reject("source endpoint is not a participant of the thread");
  }
  for (const target of message.targetEndpointIds) {
    if (!thread.participantEndpointIds.includes(target)) {
      reject(`target endpoint ${target} is not a participant of the thread`);
    }
  }

  if (context.endpointProjects) {
    const checkEndpoint = (endpointId: string): void => {
      const binding = context.endpointProjects?.get(endpointId);
      if (!binding) {
        reject(`endpoint ${endpointId} has no known binding`);
      } else if (
        binding.projectId !== message.projectId ||
        binding.taskId !== message.taskId
      ) {
        reject(`endpoint ${endpointId} is bound to a different project/task`);
      }
    };
    checkEndpoint(message.sourceEndpointId);
    for (const target of message.targetEndpointIds) {
      checkEndpoint(target);
    }
  }

  if (context.refOwnerProjects) {
    const refIds = [
      ...message.contextRefs.map((ref: ContextRef) => ref.refId),
      ...message.evidenceRefs,
    ];
    for (const refId of refIds) {
      const owner = context.refOwnerProjects.get(refId);
      if (owner === undefined) {
        reject(`referenced object ${refId} is not resolvable in this project`);
      } else if (owner !== message.projectId) {
        reject(`referenced object ${refId} belongs to a different project`);
      }
    }
  }
}
