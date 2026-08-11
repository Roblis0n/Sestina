import { z } from "zod";
import { TaskIdSchema, ProjectIdSchema, DecisionIdSchema } from "./ids.js";
import { TimestampSchema } from "./common.js";
import { ContextRefSchema } from "./conversations.js";

// ── Governance Context Packet (for governance chat) ──
export const GovernanceContextPacketSchema = z.object({
  packetId: z.string(),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema.optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "sestina"]),
    body: z.string(),
    timestamp: TimestampSchema,
  })),
  relevantDecisions: z.array(z.object({
    decisionId: DecisionIdSchema,
    category: z.string(),
    reason: z.string(),
    createdAt: TimestampSchema,
  })),
  contractSummary: z.string(),
  openReviews: z.array(z.string()),
  contextRefs: z.array(ContextRefSchema),
  constraints: z.array(z.string()),
});

// ── Governance Answer (streaming response) ──
export const GovernanceAnswerChunkSchema = z.object({
  chunkId: z.string(),
  packetId: z.string(),
  index: z.number().int().nonnegative(),
  text: z.string(),
  done: z.boolean(),
});

export const GovernanceAnswerSchema = z.object({
  answerId: z.string(),
  packetId: z.string(),
  body: z.string(),
  basis: z.object({
    sources: z.array(ContextRefSchema),
    limitations: z.array(z.string()),
    confidence: z.number().min(0).max(1).optional(),
  }),
  proposedActions: z.array(z.object({
    kind: z.string(),
    params: z.record(z.string(), z.unknown()),
    previewHash: z.string().optional(),
  })),
  unknownItems: z.array(z.string()),
  completedAt: TimestampSchema,
});

export type GovernanceContextPacket = z.infer<typeof GovernanceContextPacketSchema>;
export type GovernanceAnswerChunk = z.infer<typeof GovernanceAnswerChunkSchema>;
export type GovernanceAnswer = z.infer<typeof GovernanceAnswerSchema>;
