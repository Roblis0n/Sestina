import { z } from "zod";
import { ProjectIdSchema, TaskIdSchema, SessionIdSchema, ContractIdSchema } from "./ids.js";
import { HOST_SCHEMA, HOST_VISIBILITY_LEVEL_SCHEMA, TimestampSchema } from "./common.js";

// ── Project Root Binding ──
export const ProjectRootBindingSchema = z.object({
  rootPath: z.string(),
  label: z.string().optional(),
  establishedAt: TimestampSchema,
  fingerprint: z.string(),
});
export type ProjectRootBinding = z.infer<typeof ProjectRootBindingSchema>;

// ── SestinaProject ──
export const SestinaProjectSchema = z.object({
  projectId: ProjectIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  bindings: z.array(ProjectRootBindingSchema),
  status: z.enum(["active", "archived"]),
  defaultTaskTemplate: z.record(z.unknown()).optional(),
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
  taskId: TaskIdSchema,
  host: HOST_SCHEMA,
  hostSessionId: z.string(),
  visibilityLevel: HOST_VISIBILITY_LEVEL_SCHEMA,
  status: HostSessionStatusSchema,
  capabilities: z.array(z.string()),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type HostSession = z.infer<typeof HostSessionSchema>;
