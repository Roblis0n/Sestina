import { z } from "zod";
import { ContractIdSchema, TaskIdSchema } from "./ids.js";
import { HOST_SCHEMA, TimestampSchema } from "./common.js";
import { HandoffPreauthorizationSchema } from "./collaboration-authority.js";

// ── Source span ──
//
// Index unit: UTF-16 code units into the original user text. `start` is
// inclusive, `end` is exclusive. A span must never split a surrogate pair;
// `sourceSpanExtract` is the single sanctioned way to slice a span out of
// the source text and returns undefined for unclean boundaries.

export const SourceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
}).refine((s) => s.end >= s.start, { message: "span end must be >= start" });
export type SourceSpan = z.infer<typeof SourceSpanSchema>;

export function sourceSpanExtract(source: string, span: SourceSpan): string | undefined {
  if (span.start < 0 || span.end > source.length || span.end < span.start) return undefined;
  if (span.start < span.end) {
    const first = source.charCodeAt(span.start);
    if (first >= 0xd800 && first <= 0xdbff && span.end === span.start + 1) return undefined;
    const last = source.charCodeAt(span.end - 1);
    if (last >= 0xdc00 && last <= 0xdfff && span.start === span.end - 1) return undefined;
  }
  return source.slice(span.start, span.end);
}

// ── Source tiers ──
//
// The fixed seven-level precedence used for patch merging and boundary
// compilation (docs/09 §6): non-overridable system safety > current user
// directives > confirmed corrections > project rules > user defaults >
// templates > inference. Higher tiers win conflicts, but a higher tier
// never automatically means "hard".

export const ContractSourceTierSchema = z.enum([
  "system_safety",
  "user_directive",
  "confirmed_correction",
  "project_rule",
  "user_default",
  "template",
  "inferred",
]);
export type ContractSourceTier = z.infer<typeof ContractSourceTierSchema>;

export const CONTRACT_SOURCE_TIER_PRECEDENCE: readonly ContractSourceTier[] = [
  "system_safety",
  "user_directive",
  "confirmed_correction",
  "project_rule",
  "user_default",
  "template",
  "inferred",
];

const SOURCE_TYPE_TO_TIER: Record<string, ContractSourceTier> = {
  system_safety: "system_safety",
  user_directive: "user_directive",
  correction: "confirmed_correction",
  project_rule: "project_rule",
  user_default: "user_default",
  template: "template",
  inferred: "inferred",
};

export function sourceTypeToTier(type: string): ContractSourceTier | undefined {
  return SOURCE_TYPE_TO_TIER[type];
}

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
  // Optional: present on user-directive scope items compiled from explicit
  // prompt lines (e.g. a stated deadline) so the statement can be verified
  // against the source text; absent on synthesized or patch-added items.
  sourceSpan: SourceSpanSchema.optional(),
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
    "user_default",
    "template",
    "inferred",
  ]),
  ref: z.string().optional(),
  confidence: z.number().min(0).max(1),
  sourceSpan: SourceSpanSchema.optional(),
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
  normalizedRule: z.record(z.string(), z.unknown()).optional(),
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

/**
 * Honest carrier for semantic completeness. A deterministic no-provider
 * compile can only reach `schema_valid_only` (or `user_confirmed` once the
 * user confirms). There is no state that claims semantic verification.
 */
export const SemanticCompletenessSchema = z
  .object({
    semanticExtractorRan: z.boolean(),
    completeness: z.enum(["schema_valid_only", "provider_assisted", "user_confirmed"]),
    unknownFields: z.array(z.string().min(1).max(100)),
    notes: z.string().max(500),
  })
  .refine(
    (s) => s.semanticExtractorRan || s.completeness !== "provider_assisted",
    { message: "provider_assisted requires a semantic extractor run" },
  );
export type SemanticCompleteness = z.infer<typeof SemanticCompletenessSchema>;

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
  semanticCompleteness: SemanticCompletenessSchema.optional(),
  preauthorizations: z.array(HandoffPreauthorizationSchema).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TaskContract = z.infer<typeof TaskContractSchema>;
