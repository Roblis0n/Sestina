import { z } from "zod";
import { SestinaErrorCode } from "./errors.js";

// ── Client Role ──
export const ClientRoleSchema = z.enum(["hook", "mcp", "cli", "desktop"]);
export type ClientRole = z.infer<typeof ClientRoleSchema>;

// ── RPC Envelopes ──
export function createRpcRequestSchema<T extends z.ZodType>(paramsSchema: T) {
  return z.object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    method: z.string(),
    params: paramsSchema,
    meta: z.object({
      protocolVersion: z.literal("1.0.0"),
      clientRole: ClientRoleSchema,
      clientVersion: z.string(),
      timestamp: z.iso.datetime(),
      deadlineMs: z.number().int().positive().max(30000),
      maxResponseBytes: z.number().int().positive().max(1_048_576),
    }),
  });
}

export function createRpcSuccessSchema<T extends z.ZodType>(resultSchema: T) {
  return z.object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    result: resultSchema,
    meta: z.object({
      protocolVersion: z.literal("1.0.0"),
      serverVersion: z.string(),
      processingMs: z.number().nonnegative(),
    }),
  });
}

export const RpcFailureSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  error: z.object({
    code: z.enum(SestinaErrorCode),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  meta: z.object({
    protocolVersion: z.literal("1.0.0"),
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
    protocolVersion: z.literal("1.0.0"),
    clientRole: ClientRoleSchema,
    clientVersion: z.string(),
    timestamp: z.iso.datetime(),
    deadlineMs: z.number().int().positive().max(30000),
    maxResponseBytes: z.number().int().positive().max(1_048_576),
  }),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  result: z.unknown(),
  meta: z.object({
    protocolVersion: z.literal("1.0.0"),
    serverVersion: z.string(),
    processingMs: z.number().nonnegative(),
  }),
});
export type RpcSuccess = z.infer<typeof RpcSuccessSchema>;

// ── Stream Envelope ──
export function createStreamEnvelopeSchema<T extends z.ZodType>(eventSchema: T) {
  return z.object({
    streamId: z.string(),
    sequence: z.number().int().nonnegative(),
    event: eventSchema,
    timestamp: z.iso.datetime(),
  });
}

export const StreamEnvelopeSchema = z.object({
  streamId: z.string(),
  sequence: z.number().int().nonnegative(),
  event: z.unknown(),
  timestamp: z.iso.datetime(),
});
export type StreamEnvelope = z.infer<typeof StreamEnvelopeSchema>;

// ── RPC Method Names ──
export const RpcMethodSchema = z.enum([
  "runtime.health", "event.submit", "task.resolve",
  "project.list", "project.get", "project.create", "project.update", "project.archive",
  "conversation.list", "conversation.get", "conversation.send", "conversation.archive",
  "contract.get", "contract.proposePatch", "contract.applyConfirmedPatch",
  "decision.get", "decision.explain", "decision.reevaluate",
  "review.list", "review.get", "review.resolve",
  "override.propose", "override.confirm", "override.revoke",
  "privacy.preview", "config.getEffective", "config.proposeChange",
  "config.applyConfirmedChange", "stream.subscribe",
]);
export type RpcMethod = z.infer<typeof RpcMethodSchema>;
