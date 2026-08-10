import { z } from "zod";
import { ContractIdSchema, TaskIdSchema } from "./ids.js";
import { HOST_SCHEMA, TimestampSchema } from "./common.js";

// ── Objective ──
export const ObjectiveSchema = z.object({
  primary: z.string().min(1).max(2000),
  rationale: z.string().max(5000).optional(),
  priority: z.enum(["critical", "high", "normal", "low"]),
  successSignal: z.string().max(2000).optional(),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

// ── Deliverable ──
export const DeliverableStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "satisfied",
  "waived",
]);
export type DeliverableStatus = z.infer<typeof DeliverableStatusSchema>;

export const DeliverableSchema = z.object({
  deliverableId: z.string(),
  description: z.string().min(1).max(2000),
  acceptanceChecks: z.array(z.string()),
  required: z.boolean(),
  status: DeliverableStatusSchema,
  evidenceRefs: z.array(z.string()),
  waivedBy: z.string().optional(),
  waiverReason: z.string().optional(),
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

// ── Scope ──
export const ScopeItemSchema = z.object({
  statement: z.string().min(1).max(2000),
  source: z.string(),
  appliesTo: z.object({
    paths: z.array(z.string()).optional(),
    domains: z.array(z.string()).optional(),
    timeRange: z
      .object({
        start: TimestampSchema.optional(),
        end: TimestampSchema.optional(),
      })
      .optional(),
  }),
  readonly: z.boolean(),
  writable: z.boolean(),
  outbound: z.boolean(),
  confidence: z.number().min(0).max(1),
  invalidationConditions: z.array(z.string()).optional(),
});
export type ScopeItem = z.infer<typeof ScopeItemSchema>;

// ── Boundary ──
export const BoundaryKindSchema = z.enum([
  "objective",
  "scope",
  "evidence",
  "authority",
  "action",
  "budget",
  "privacy",
  "completion",
  "process",
]);
export type BoundaryKind = z.infer<typeof BoundaryKindSchema>;

export const BoundarySeveritySchema = z.enum(["hard", "soft", "open"]);
export type BoundarySeverity = z.infer<typeof BoundarySeveritySchema>;

export const BoundarySourceSchema = z.object({
  type: z.enum([
    "user_directive",
    "project_rule",
    "system_safety",
    "correction",
    "template",
    "inferred",
  ]),
  ref: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type BoundarySource = z.infer<typeof BoundarySourceSchema>;

export const BoundaryOwnerSchema = z.enum([
  "user",
  "project",
  "system",
  "inferred",
]);
export type BoundaryOwner = z.infer<typeof BoundaryOwnerSchema>;

export const ApplicabilitySchema = z.object({
  hosts: z.array(HOST_SCHEMA).optional(),
  tools: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
  exceptWhen: z.array(z.string()).optional(),
});
export type Applicability = z.infer<typeof ApplicabilitySchema>;

export const BoundarySchema = z.object({
  boundaryId: z.string(),
  kind: BoundaryKindSchema,
  severity: BoundarySeveritySchema,
  statement: z.string().min(1).max(3000),
  normalizedRule: z.record(z.unknown()).optional(),
  source: BoundarySourceSchema,
  owner: BoundaryOwnerSchema,
  overridable: z.boolean(),
  appliesTo: ApplicabilitySchema,
  confidence: z.number().min(0).max(1),
  status: z.enum(["active", "superseded", "expired"]),
  validFrom: TimestampSchema,
  validUntil: TimestampSchema.optional(),
});
export type Boundary = z.infer<typeof BoundarySchema>;

// ── Policies ──
export const EvidencePolicySchema = z.object({
  requireSourceForClaims: z.boolean(),
  minEvidenceLevel: z.enum(["none", "reference", "excerpt", "hash"]),
  allowUserTestimony: z.boolean(),
});
export type EvidencePolicy = z.infer<typeof EvidencePolicySchema>;

export const AuthorityPolicySchema = z.object({
  executorCanChooseMethods: z.boolean(),
  executorCanProposeScope: z.boolean(),
  executorCanSelfReview: z.boolean(),
  overridesRequireUserConfirmation: z.boolean(),
});
export type AuthorityPolicy = z.infer<typeof AuthorityPolicySchema>;

export const BudgetPolicySchema = z.object({
  maxToolCallsPerTask: z.number().int().positive().optional(),
  maxProviderCallsPerTask: z.number().int().positive().optional(),
  maxJudgmentCostPerTask: z.number().positive().optional(),
});
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;

export const StopConditionSchema = z.object({
  condition: z.string(),
  isMet: z.boolean(),
  evidenceRequired: z.boolean(),
});
export type StopCondition = z.infer<typeof StopConditionSchema>;

export const AssumptionSchema = z.object({
  statement: z.string(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.enum(["active", "invalidated", "confirmed"]),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const SourceRefSchema = z.object({
  ref: z.string(),
  type: z.enum(["user_message", "project_rule", "correction", "template", "external"]),
  excerpt: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

// ── TaskContract ──
export const ContractStatusSchema = z.enum([
  "draft",
  "active",
  "completed",
  "cancelled",
]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const TaskContractSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  contractId: ContractIdSchema,
  taskId: TaskIdSchema,
  version: z.number().int().min(1),
  status: ContractStatusSchema,
  title: z.string().min(1).max(500),
  objective: ObjectiveSchema,
  deliverables: z.array(DeliverableSchema),
  scope: z.object({
    in: z.array(ScopeItemSchema),
    out: z.array(ScopeItemSchema),
  }),
  boundaries: z.array(BoundarySchema),
  evidencePolicy: EvidencePolicySchema,
  authority: AuthorityPolicySchema,
  budgets: BudgetPolicySchema,
  stopConditions: z.array(StopConditionSchema),
  assumptions: z.array(AssumptionSchema),
  correctionRefs: z.array(z.string()),
  sourceRefs: z.array(SourceRefSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TaskContract = z.infer<typeof TaskContractSchema>;
