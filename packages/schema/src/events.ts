import { z } from "zod";
import { EventIdSchema, TaskIdSchema, SessionIdSchema, ProjectIdSchema, IdempotencyKeySchema } from "./ids.js";
import { HOST_SCHEMA, HOST_VISIBILITY_LEVEL_SCHEMA, PRIVACY_CLASS_SCHEMA, TimestampSchema } from "./common.js";

// ── Action ──
export const ActionCategorySchema = z.enum([
  "read",
  "write",
  "delete",
  "execute",
  "network",
  "publish",
  "deploy",
  "message",
  "unknown",
]);
export type ActionCategory = z.infer<typeof ActionCategorySchema>;

export const ActionDescriptorSchema = z.object({
  toolName: z.string().optional(),
  category: ActionCategorySchema,
  reversible: z.boolean(),
  external: z.boolean(),
  resourceRefs: z.array(z.string()),
  securitySummary: z.string().optional(),
});
export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;

// ── Content ──
export const ContentDescriptorSchema = z.object({
  hasPrompt: z.boolean(),
  promptLength: z.number().int().nonnegative().optional(),
  hasFiles: z.boolean(),
  fileCount: z.number().int().nonnegative().optional(),
  hasOutput: z.boolean(),
  outputLength: z.number().int().nonnegative().optional(),
  totalChars: z.number().int().nonnegative(),
});
export type ContentDescriptor = z.infer<typeof ContentDescriptorSchema>;

// ── Event Types ──
export const EventTypeSchema = z.enum([
  "session_start",
  "user_prompt",
  "pre_tool",
  "permission_request",
  "post_tool",
  "tool_failure",
  "pre_compact",
  "post_compact",
  "stop",
  "session_end",
  "mcp_command",
  "host_stream",
  "ui_action",
  "chat_message",
  "review_action",
  "health_change",
  "collaboration_message",
  "collaboration_delivery",
  "collaboration_action",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

// ── StandardEvent ──
export const StandardEventSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  eventId: EventIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  eventType: EventTypeSchema,
  host: HOST_SCHEMA,
  hostVersion: z.string().optional(),
  pluginVersion: z.string().optional(),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  sessionId: SessionIdSchema,
  action: ActionDescriptorSchema.optional(),
  content: ContentDescriptorSchema.optional(),
  occurredAt: TimestampSchema,
  receivedAt: TimestampSchema,
  bypass: z.boolean(),
  privacyClass: PRIVACY_CLASS_SCHEMA,
  // The replay/identity anchor (storage lease reuse checks compare it): a
  // lowercase sha256 hex digest of the exact raw bytes, never free text.
  rawPayloadHash: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/, "rawPayloadHash must be a lowercase sha256 hex digest"),
  sourceCapability: z.string().optional(),
  hostVisibilityLevel: HOST_VISIBILITY_LEVEL_SCHEMA.optional(),
});
export type StandardEvent = z.infer<typeof StandardEventSchema>;
