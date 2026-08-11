import { z } from "zod";
import { ConversationIdSchema, ProjectIdSchema, TaskIdSchema } from "./ids.js";
import { TimestampSchema } from "./common.js";

// ── Conversation Type ──
export const ConversationTypeSchema = z.enum([
  "governance_chat",
  "decision_review",
]);
export type ConversationType = z.infer<typeof ConversationTypeSchema>;

// ── Conversation ──
export const ConversationSchema = z.object({
  conversationId: ConversationIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema.optional(),
  type: ConversationTypeSchema,
  title: z.string().min(1).max(500),
  status: z.enum(["active", "archived"]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

// ── Context Ref ──
export const ContextRefTypeSchema = z.enum([
  "task",
  "decision",
  "event",
  "contract_version",
  "boundary",
  "evidence",
  "claim",
  "correction",
  "host_session",
  "review",
]);
export type ContextRefType = z.infer<typeof ContextRefTypeSchema>;

export const ContextRefSchema = z.object({
  refType: ContextRefTypeSchema,
  refId: z.string(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
  resolvedAt: TimestampSchema.optional(),
  resolutionStatus: z.enum(["current", "stale", "missing"]),
});
export type ContextRef = z.infer<typeof ContextRefSchema>;

// ── Answer Basis ──
export const AnswerBasisSchema = z.object({
  sources: z.array(ContextRefSchema),
  limitations: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
});
export type AnswerBasis = z.infer<typeof AnswerBasisSchema>;

// ── Governance Actions ──
export const GovernanceActionKindSchema = z.enum([
  "correct_fact",
  "add_evidence",
  "revise_contract",
  "record_correction",
  "reevaluate_decision",
  "override_decision",
  "attach_session",
  "detach_session",
  "change_project_setting",
  "resolve_review",
  "reopen_review",
]);
export type GovernanceActionKind = z.infer<typeof GovernanceActionKindSchema>;

export const GovernanceActionProposalSchema = z.object({
  kind: GovernanceActionKindSchema,
  params: z.record(z.string(), z.unknown()),
  previewHash: z.string().optional(),
});
export type GovernanceActionProposal = z.infer<
  typeof GovernanceActionProposalSchema
>;

// ── Conversation Message ──
export const MessageRoleSchema = z.enum(["user", "sestina", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageStatusSchema = z.enum([
  "streaming",
  "complete",
  "failed",
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const ConversationMessageSchema = z.object({
  messageId: z.string(),
  conversationId: ConversationIdSchema,
  role: MessageRoleSchema,
  body: z.string().max(25000),
  answerBasis: AnswerBasisSchema.optional(),
  contextRefs: z.array(ContextRefSchema),
  proposedAction: GovernanceActionProposalSchema.optional(),
  confirmable: z.boolean(),
  status: MessageStatusSchema,
  createdAt: TimestampSchema,
});
export type ConversationMessage = z.infer<
  typeof ConversationMessageSchema
>;

// ── Stream State ──
export const ConversationStreamStateSchema = z.object({
  isStreaming: z.boolean(),
  lastSequence: z.number().int().nonnegative(),
  draftText: z.string(),
  pendingActionCard: GovernanceActionProposalSchema.optional(),
});
export type ConversationStreamState = z.infer<
  typeof ConversationStreamStateSchema
>;
