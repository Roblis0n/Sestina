import { z } from "zod";
import { ProjectIdSchema, TaskIdSchema, SessionIdSchema, ContractIdSchema } from "./ids.js";
import { HOST_SCHEMA, HOST_VISIBILITY_LEVEL_SCHEMA, TimestampSchema } from "./common.js";

// ── Project Root Binding ──
// `fingerprint` is content-independent (derived from the canonical path and,
// when present, the Git remote — never from file contents, docs/30 §3/§4), so
// a moved root can be re-associated by fingerprint plus user confirmation
// instead of silently creating a duplicate project. The canonical columns
// (migration 009) are authoritative; `source`, `confirmed` and
// `caseSemantics` stay optional here so pre-009 data JSON remains valid.
export const ProjectRootBindingSchema = z.object({
  rootPath: z.string(),
  label: z.string().optional(),
  establishedAt: TimestampSchema,
  fingerprint: z.string(),
  source: z.enum(["discovered", "user_added", "user_confirmed"]).optional(),
  confirmed: z.boolean().optional(),
  /** Platform case semantics of the root's filesystem (docs/30 §3). */
  caseSemantics: z.enum(["case_insensitive", "case_sensitive"]).optional(),
});
export type ProjectRootBinding = z.infer<typeof ProjectRootBindingSchema>;

// ── SestinaProject ──
export const SestinaProjectSchema = z.object({
  projectId: ProjectIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  bindings: z.array(ProjectRootBindingSchema),
  status: z.enum(["active", "archived"]),
  defaultTaskTemplate: z.record(z.string(), z.unknown()).optional(),
  privacyProfile: z.string().optional(),
  providerProfile: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SestinaProject = z.infer<typeof SestinaProjectSchema>;

// ── Task ──
export const TaskStatusSchema = z.enum([
  "draft",
  "active",
  "blocked",
  "completed",
  "cancelled",
  "archived",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum([
  "critical",
  "high",
  "normal",
  "low",
]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  taskId: TaskIdSchema,
  projectId: ProjectIdSchema,
  title: z.string().min(1).max(500),
  status: TaskStatusSchema,
  contractId: ContractIdSchema.optional(),
  priority: TaskPrioritySchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Task = z.infer<typeof TaskSchema>;

// ── Host Session ──
export const HostSessionStatusSchema = z.enum(["connected", "disconnected"]);
export type HostSessionStatus = z.infer<typeof HostSessionStatusSchema>;

export const HostSessionSchema = z.object({
  sessionId: SessionIdSchema,
  // Optional since migration 009: a session may be unattached while its task
  // attachment is ambiguous or unresolved (docs/30 §5 "未关联会话").
  taskId: TaskIdSchema.optional(),
  host: HOST_SCHEMA,
  hostSessionId: z.string(),
  visibilityLevel: HOST_VISIBILITY_LEVEL_SCHEMA,
  status: HostSessionStatusSchema,
  capabilities: z.array(z.string()),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type HostSession = z.infer<typeof HostSessionSchema>;

// ── Session-Task Attachment History ──
// Append-only attachment records (docs/30 §5): every attach/detach writes a
// row, the row with detachedAt unset is the current attachment, and the
// session's task_id column is the materialized current value.
export const SessionAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  sessionId: SessionIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  attachedAt: TimestampSchema,
  detachedAt: TimestampSchema.optional(),
  reason: z.string().max(1000).optional(),
});
export type SessionAttachment = z.infer<typeof SessionAttachmentSchema>;

// ── Unowned Activity Queue ──
// Host events that cannot resolve a project (docs/30 §10) wait here until the
// user fixes the attribution; the original raw payload is retained so the
// event can be re-normalized after resolution — the queue is the source of
// truth for re-attribution, not a privacy-free zone: it lives in the same
// local database and the same isolation rules as every other table.
export const UnownedActivityReasonSchema = z.enum([
  "no_project",
  "root_conflict",
  "ambiguous_binding",
]);
export type UnownedActivityReason = z.infer<typeof UnownedActivityReasonSchema>;

export const UnownedActivitySchema = z.object({
  unownedId: z.string().min(1),
  host: HOST_SCHEMA,
  hostSessionId: z.string(),
  occurredAt: TimestampSchema,
  reason: UnownedActivityReasonSchema,
  /** The exact raw event JSON — retained for re-normalization on resolution. */
  rawEvent: z.string(),
  /** Lowercase sha256 hex digest of rawEvent. */
  payloadHash: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/, "payloadHash must be a lowercase sha256 hex digest"),
  createdAt: TimestampSchema,
  resolvedAt: TimestampSchema.optional(),
  resolvedProjectId: ProjectIdSchema.optional(),
  resolvedTaskId: TaskIdSchema.optional(),
});
export type UnownedActivity = z.infer<typeof UnownedActivitySchema>;
