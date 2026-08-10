import { z } from "zod";
import {
  TraceIdSchema,
  DecisionIdSchema,
  EventIdSchema,
  SessionIdSchema,
  ProjectIdSchema,
  TaskIdSchema,
} from "./ids.js";
import { TimestampSchema } from "./common.js";

// ── Decision Trace ──
export const TraceStageSchema = z.enum([
  "received",
  "normalized",
  "local_evaluating",
  "packet_building",
  "redaction",
  "judge_requested",
  "judge_responding",
  "merging",
  "persisted",
  "presented",
]);
export type TraceStage = z.infer<typeof TraceStageSchema>;

export const TraceStageStatusSchema = z.enum([
  "started",
  "completed",
  "skipped",
  "failed",
]);
export type TraceStageStatus = z.infer<typeof TraceStageStatusSchema>;

export const DecisionTraceStageSchema = z.object({
  stage: TraceStageSchema,
  status: TraceStageStatusSchema,
  input: z.record(z.unknown()).optional(),
  output: z.record(z.unknown()).optional(),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  limitations: z.array(z.string()),
});
export type DecisionTraceStage = z.infer<typeof DecisionTraceStageSchema>;

export const DecisionTraceSchema = z.object({
  traceId: TraceIdSchema,
  decisionId: DecisionIdSchema,
  eventId: EventIdSchema,
  stages: z.array(DecisionTraceStageSchema),
  totalProcessingMs: z.number().nonnegative(),
  visibleToUser: z.boolean(),
  limitations: z.array(z.string()),
});
export type DecisionTrace = z.infer<typeof DecisionTraceSchema>;

// ── Host Stream ──
export const HostStreamEventTypeSchema = z.enum([
  "user_message",
  "assistant_message",
  "reasoning_summary",
  "tool_start",
  "tool_input",
  "tool_output",
  "tool_completion",
  "approval_request",
  "approval_response",
  "status",
  "error",
]);
export type HostStreamEventType = z.infer<typeof HostStreamEventTypeSchema>;

export const HostStreamEventSchema = z.object({
  streamEventId: z.string(),
  sessionId: SessionIdSchema,
  sequence: z.number().int().nonnegative(),
  eventType: HostStreamEventTypeSchema,
  content: z.string(),
  toolName: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  sourceCapability: z.string(),
  occurredAt: TimestampSchema,
  gapBefore: z.boolean().optional(),
  gapAfter: z.boolean().optional(),
});
export type HostStreamEvent = z.infer<typeof HostStreamEventSchema>;

// ── Activity ──
export const ActivityCategorySchema = z.enum([
  "allow",
  "intervention",
  "block",
  "review",
  "system",
]);
export type ActivityCategory = z.infer<typeof ActivityCategorySchema>;

export const AttentionLevelSchema = z.enum([
  "silent",
  "feed",
  "badge",
  "notify",
  "urgent",
]);
export type AttentionLevel = z.infer<typeof AttentionLevelSchema>;

export const ActivityEventSchema = z.object({
  activityId: z.string(),
  occurredAt: TimestampSchema,
  eventType: z.string(),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  decisionId: DecisionIdSchema.optional(),
  summary: z.string(),
  category: ActivityCategorySchema,
  attentionLevel: AttentionLevelSchema,
  foldKey: z.string().optional(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

// ── Notification ──
export const NotificationChannelSchema = z.enum([
  "os_notification",
  "feed_item",
  "badge",
]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationStateSchema = z.object({
  notificationId: z.string(),
  activityId: z.string(),
  deliveredAt: TimestampSchema,
  channel: NotificationChannelSchema,
  acknowledged: z.boolean(),
});
export type NotificationState = z.infer<typeof NotificationStateSchema>;

// ── Health ──
export const HealthComponentSchema = z.enum([
  "background_runtime",
  "sqlite",
  "provider_openai",
  "provider_anthropic",
  "provider_local",
  "codex_hooks",
  "claude_hooks",
  "desktop_ipc",
]);
export type HealthComponent = z.infer<typeof HealthComponentSchema>;

export const HealthStatusSchema = z.enum([
  "healthy",
  "degraded",
  "unavailable",
  "unknown",
]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const HealthCheckSchema = z.object({
  component: HealthComponentSchema,
  status: HealthStatusSchema,
  message: z.string(),
  checkedAt: TimestampSchema,
  latencyMs: z.number().nonnegative().optional(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
