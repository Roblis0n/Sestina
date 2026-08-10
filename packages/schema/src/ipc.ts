import { z } from "zod";
import { SestinaErrorCodeSchema } from "./errors.js";

// ── Client Role ──
export const ClientRoleSchema = z.enum(["hook", "mcp", "cli", "desktop"]);
export type ClientRole = z.infer<typeof ClientRoleSchema>;

// ── RPC Envelopes ──
export function createRpcRequestSchema<T extends z.ZodTypeAny>(paramsSchema: T) {
  return z.object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    method: z.string(),
    params: paramsSchema,
    meta: z.object({
      clientRole: ClientRoleSchema,
      clientVersion: z.string(),
      timestamp: z.string().datetime(),
    }),
  });
}

export function createRpcSuccessSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    result: resultSchema,
    meta: z.object({
      serverVersion: z.string(),
      processingMs: z.number().nonnegative(),
    }),
  });
}

export const RpcFailureSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  error: z.object({
    code: SestinaErrorCodeSchema,
    message: z.string(),
    data: z.unknown().optional(),
  }),
  meta: z.object({
    serverVersion: z.string(),
  }),
});
export type RpcFailure = z.infer<typeof RpcFailureSchema>;

// Generic version for untyped usage
export const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
  meta: z.object({
    clientRole: ClientRoleSchema,
    clientVersion: z.string(),
    timestamp: z.string().datetime(),
  }),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  result: z.unknown(),
  meta: z.object({
    serverVersion: z.string(),
    processingMs: z.number().nonnegative(),
  }),
});
export type RpcSuccess = z.infer<typeof RpcSuccessSchema>;

// ── Stream Envelope ──
export function createStreamEnvelopeSchema<T extends z.ZodTypeAny>(eventSchema: T) {
  return z.object({
    streamId: z.string(),
    sequence: z.number().int().nonnegative(),
    event: eventSchema,
    timestamp: z.string().datetime(),
  });
}

export const StreamEnvelopeSchema = z.object({
  streamId: z.string(),
  sequence: z.number().int().nonnegative(),
  event: z.unknown(),
  timestamp: z.string().datetime(),
});
export type StreamEnvelope = z.infer<typeof StreamEnvelopeSchema>;

// ── RPC Method Names ──
export const RPC_METHODS = [
  // System
  "health",
  "handshake",
  "capabilities",

  // Projects
  "project.list",
  "project.get",
  "project.create",
  "project.update",
  "project.archive",

  // Tasks
  "task.list",
  "task.get",
  "task.create",
  "task.update",
  "task.attach_session",

  // Contracts
  "contract.get",
  "contract.update",
  "contract.diff",
  "contract.patch",

  // Decisions
  "decision.get",
  "decision.list",
  "decision.trace",
  "decision.reevaluate",
  "decision.override",

  // Evidence
  "evidence.record",
  "evidence.list",
  "claim.record",
  "claim.list",
  "correction.record",

  // Governance Chat
  "chat.send",
  "chat.history",
  "chat.confirm_action",

  // Reviews
  "review.list",
  "review.get",
  "review.resolve",

  // Config
  "config.get",
  "config.update",
  "config.preview",

  // Privacy & Data
  "privacy.preview",
  "privacy.cleanup",
  "export.task",
  "export.project",

  // Provider
  "provider.test",
] as const;

export const RpcMethodSchema = z.enum(RPC_METHODS);
export type RpcMethod = z.infer<typeof RpcMethodSchema>;
