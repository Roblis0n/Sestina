import { z } from "zod";
import {
  ReviewIdSchema,
  ProjectIdSchema,
  TaskIdSchema,
  DecisionIdSchema,
} from "./ids.js";
import { TimestampSchema, ActorProvenanceSchema } from "./common.js";
import { DecisionSchema, OverrideGrantSchema, JudgeActionSchema } from "./decisions.js";
import { SituationAssertionSchema } from "./evidence.js";
import { ContextRefSchema } from "./conversations.js";

// ── Review Triggers ──
export const ReviewTriggerSchema = z.enum([
  "overridable_block",
  "user_decision_required",
  "low_confidence_major",
  "degradation",
  "contract_conflict",
  "visibility_gap",
  "user_reported_error",
]);
export type ReviewTrigger = z.infer<typeof ReviewTriggerSchema>;

// ── Review Item ──
export const ReviewStatusSchema = z.enum([
  "open",
  "in_review",
  "resolved",
  "dismissed",
  "superseded",
]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewItemSchema = z.object({
  reviewId: ReviewIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  trigger: ReviewTriggerSchema,
  title: z.string().min(1).max(500),
  description: z.string().max(5000),
  requiredDecision: z.string(),
  availableActions: z.array(z.string()),
  decisionRef: DecisionIdSchema.optional(),
  contextRefs: z.array(ContextRefSchema),
  status: ReviewStatusSchema,
  priority: z.number().int().min(0).max(4),
  openedAt: TimestampSchema,
  resolvedAt: TimestampSchema.optional(),
  resolutionNote: z.string().optional(),
  resolvedBy: ActorProvenanceSchema.optional(),
  version: z.number().int().min(1),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

// ── Review Action ──
export const ReviewActionTypeSchema = z.enum([
  "accept",
  "reject",
  "modify",
  "defer",
  "escalate",
]);
export type ReviewActionType = z.infer<typeof ReviewActionTypeSchema>;

export const ReviewActionSchema = z.object({
  reviewId: ReviewIdSchema,
  action: ReviewActionTypeSchema,
  reason: z.string(),
  newFacts: z.array(SituationAssertionSchema).optional(),
  contractPatch: z.record(z.string(), z.unknown()).optional(),
  overrideProposal: OverrideGrantSchema.optional(),
  newDecision: DecisionSchema.optional(),
  performedBy: ActorProvenanceSchema,
  performedAt: TimestampSchema,
});
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

// ── False Classification ──
export const FalseClassificationCategorySchema = z.enum([
  "false_positive",
  "false_negative",
  "severity_misclassified",
  "boundary_misattributed",
]);
export type FalseClassificationCategory = z.infer<
  typeof FalseClassificationCategorySchema
>;

export const FalseClassificationSchema = z.object({
  originalDecisionId: DecisionIdSchema,
  reportedCategory: FalseClassificationCategorySchema,
  actualCategory: JudgeActionSchema,
  boundaryIds: z.array(z.string()),
  notes: z.string().optional(),
});
export type FalseClassification = z.infer<typeof FalseClassificationSchema>;
