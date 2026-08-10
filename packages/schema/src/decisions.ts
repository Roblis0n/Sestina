import { z } from "zod";
import { DecisionIdSchema, EventIdSchema, TaskIdSchema } from "./ids.js";
import { TimestampSchema, ActorProvenanceSchema, DegradationStateSchema } from "./common.js";
import { BoundarySchema } from "./contracts.js";

// ── Judge Actions ──
export const JudgeActionSchema = z.enum([
  "allow",
  "annotate",
  "steer",
  "require_evidence",
  "block",
  "require_user_decision",
  "continue_working",
]);
export type JudgeAction = z.infer<typeof JudgeActionSchema>;

// ── Drift Classes ──
export const DriftClassSchema = z.enum([
  "goal_substitution",
  "scope_inflation",
  "scope_omission",
  "premise_risk",
  "evidence_gap",
  "authority_violation",
  "forbidden_action",
  "premature_completion",
  "process_fixation",
  "unnecessary_question",
  "budget_overrun",
  "privacy_boundary",
  "correction_recurrence",
  "premature_certainty",
]);
export type DriftClass = z.infer<typeof DriftClassSchema>;

// ── Excerpts for Judgment Packet ──
export const BoundaryExcerptSchema = z.object({
  boundaryId: z.string(),
  kind: z.string(),
  severity: z.string(),
  statement: z.string(),
});
export type BoundaryExcerpt = z.infer<typeof BoundaryExcerptSchema>;

export const EventExcerptSchema = z.object({
  eventType: z.string(),
  toolName: z.string().optional(),
  category: z.string().optional(),
  resourceRefs: z.array(z.string()),
  isExternal: z.boolean(),
});
export type EventExcerpt = z.infer<typeof EventExcerptSchema>;

export const EvidenceExcerptSchema = z.object({
  evidenceId: z.string(),
  type: z.string(),
  status: z.string(),
  excerpt: z.string().optional(),
});
export type EvidenceExcerpt = z.infer<typeof EvidenceExcerptSchema>;

export const CorrectionExcerptSchema = z.object({
  correctionId: z.string(),
  failureClass: z.string(),
  excerpt: z.string(),
  recurrenceCount: z.number().int().nonnegative(),
});
export type CorrectionExcerpt = z.infer<typeof CorrectionExcerptSchema>;

// ── Judgment Packet ──
export const JudgmentPacketSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  judgmentId: z.string(),
  task: z.object({
    objective: z.string(),
    currentDeliverables: z.array(z.string()),
  }),
  relevantBoundaries: z.array(BoundaryExcerptSchema),
  candidateIssueTypes: z.array(DriftClassSchema),
  currentEvent: EventExcerptSchema,
  relevantEvidence: z.array(EvidenceExcerptSchema),
  recentCorrections: z.array(CorrectionExcerptSchema),
  requestedDecision: z.enum([
    "action",
    "claim",
    "completion",
    "contract_patch",
  ]),
  allowedOpinionActions: z.array(JudgeActionSchema),
  privacy: z.object({
    redactions: z.number().int().nonnegative(),
    originalChars: z.number().int().nonnegative(),
    sentChars: z.number().int().nonnegative(),
  }),
});
export type JudgmentPacket = z.infer<typeof JudgmentPacketSchema>;

// ── Judge Opinion ──
export const JudgeOpinionSchema = z.object({
  issueDetected: z.boolean(),
  issueTypes: z.array(DriftClassSchema),
  severity: z.number().int().min(0).max(4),
  confidence: z.number().min(0).max(1),
  recommendedAction: JudgeActionSchema,
  boundaryIds: z.array(z.string()),
  reason: z.string(),
  recoverySteps: z.array(z.string()),
  evidenceGaps: z.array(z.string()),
});
export type JudgeOpinion = z.infer<typeof JudgeOpinionSchema>;

// ── Judge Execution ──
export const JudgeExecutionStatusSchema = z.enum([
  "not_needed",
  "succeeded",
  "unavailable",
  "timeout",
  "invalid",
  "budget_skipped",
]);
export type JudgeExecutionStatus = z.infer<typeof JudgeExecutionStatusSchema>;

export const JudgeExecutionSchema = z.object({
  status: JudgeExecutionStatusSchema,
  provider: z.string().optional(),
  model: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  packetHash: z.string().optional(),
});
export type JudgeExecution = z.infer<typeof JudgeExecutionSchema>;

// ── Decision ──
export const DecisionSchema = z.object({
  decisionId: DecisionIdSchema,
  eventId: EventIdSchema,
  taskId: TaskIdSchema,
  category: JudgeActionSchema,
  riskLevel: z.number().int().min(0).max(4),
  reasonCode: z.string(),
  reason: z.string(),
  boundaryIds: z.array(z.string()),
  ruleFindingIds: z.array(z.string()),
  recoverySteps: z.array(z.string()),
  userDecisionNeeded: z.boolean(),
  overridable: z.boolean(),
  judge: JudgeExecutionSchema,
  degradation: DegradationStateSchema.optional(),
  contractVersion: z.number().int().min(1),
  createdAt: TimestampSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

// ── Override ──
export const OverrideScopeSchema = z.enum([
  "single_use",
  "session",
  "task_until_contract_change",
  "time_limited",
]);
export type OverrideScope = z.infer<typeof OverrideScopeSchema>;

export const OverrideStatusSchema = z.enum([
  "active",
  "used",
  "expired",
  "revoked",
]);
export type OverrideStatus = z.infer<typeof OverrideStatusSchema>;

export const OverrideGrantSchema = z.object({
  overrideId: z.string(),
  decisionId: DecisionIdSchema,
  reason: z.string(),
  scope: OverrideScopeSchema,
  boundaryIds: z.array(z.string()),
  actionFingerprint: z.string().optional(),
  resourceScope: z.array(z.string()).optional(),
  issuedBy: ActorProvenanceSchema,
  issuedAt: TimestampSchema,
  usedAt: TimestampSchema.optional(),
  expiresAt: TimestampSchema.optional(),
  revokedAt: TimestampSchema.optional(),
  status: OverrideStatusSchema,
});
export type OverrideGrant = z.infer<typeof OverrideGrantSchema>;

// ── Decision Revision ──
export const DecisionRevisionSchema = z.object({
  revisionId: z.string(),
  originalDecisionId: DecisionIdSchema,
  revisedById: z.string(),
  reason: z.string(),
  newCategory: JudgeActionSchema,
  newReason: z.string(),
  createdAt: TimestampSchema,
});
export type DecisionRevision = z.infer<typeof DecisionRevisionSchema>;
