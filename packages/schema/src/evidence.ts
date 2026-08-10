import { z } from "zod";
import { TaskIdSchema, ProjectIdSchema } from "./ids.js";
import { TimestampSchema, ActorProvenanceSchema } from "./common.js";
import { DriftClassSchema } from "./decisions.js";

// ── Evidence ──
export const EvidenceTypeSchema = z.enum([
  "primary_source",
  "secondary_source",
  "dataset",
  "observation",
  "test_result",
  "calculation",
  "expert_judgment",
  "user_statement",
  "artifact",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceLocatorSchema = z.object({
  type: z.enum(["path", "url", "database", "command_output", "artifact"]),
  value: z.string(),
  lineRange: z
    .object({
      start: z.number().int().positive().optional(),
      end: z.number().int().positive().optional(),
    })
    .optional(),
  contentHash: z.string().optional(),
});
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;

export const EvidenceStatusSchema = z.enum([
  "unverified",
  "verified",
  "disputed",
  "superseded",
  "unavailable",
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const EvidenceItemSchema = z.object({
  evidenceId: z.string(),
  taskId: TaskIdSchema,
  type: EvidenceTypeSchema,
  locator: EvidenceLocatorSchema,
  excerpt: z.string().max(5000).optional(),
  contentHash: z.string().optional(),
  status: EvidenceStatusSchema,
  provenance: z.string(),
  recordedBy: z.enum(["user", "agent", "hook", "import"]),
  observedAt: TimestampSchema.optional(),
  expiresAt: TimestampSchema.optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ── Claims ──
export const ClaimTypeSchema = z.enum([
  "factual",
  "causal",
  "predictive",
  "comparative",
  "completion",
  "recommendation",
  "assumption",
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClaimImportanceSchema = z.enum([
  "critical",
  "material",
  "supporting",
]);
export type ClaimImportance = z.infer<typeof ClaimImportanceSchema>;

export const ClaimStatusSchema = z.enum([
  "supported",
  "partially_supported",
  "contradicted",
  "unverified",
  "not_applicable",
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimSchema = z.object({
  claimId: z.string(),
  taskId: TaskIdSchema,
  text: z.string().min(1).max(5000),
  type: ClaimTypeSchema,
  importance: ClaimImportanceSchema,
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()),
  status: ClaimStatusSchema,
  limitations: z.array(z.string()),
});
export type Claim = z.infer<typeof ClaimSchema>;

// ── Corrections ──
export const CorrectionScopeSchema = z.enum([
  "session",
  "task",
  "project",
  "user",
]);
export type CorrectionScope = z.infer<typeof CorrectionScopeSchema>;

export const CorrectionSchema = z.object({
  correctionId: z.string(),
  taskId: TaskIdSchema,
  userFeedback: z.string().min(1).max(3000),
  originalEventRef: z.string().optional(),
  normalizedInstruction: z.string(),
  failureClass: DriftClassSchema,
  scope: CorrectionScopeSchema,
  severity: z.number().int().min(0).max(4),
  confirmed: z.boolean(),
  recurrenceCount: z.number().int().nonnegative(),
  expiresWhen: TimestampSchema.optional(),
  supersededBy: z.string().optional(),
});
export type Correction = z.infer<typeof CorrectionSchema>;

// ── Situation Assertion ──
export const AssertionKindSchema = z.enum([
  "confirmed_fact",
  "reported_fact",
  "inference",
  "assumption",
  "unknown",
  "unavailable",
]);
export type AssertionKind = z.infer<typeof AssertionKindSchema>;

export const AssertionStatusSchema = z.enum([
  "active",
  "disputed",
  "superseded",
  "expired",
]);
export type AssertionStatus = z.infer<typeof AssertionStatusSchema>;

export const SituationAssertionSchema = z.object({
  assertionId: z.string(),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema.optional(),
  kind: AssertionKindSchema,
  statement: z.string().min(1).max(3000),
  sourceRefs: z.array(z.record(z.unknown())), // Full ContextRef in conversations.ts
  confidence: z.number().min(0).max(1).optional(),
  limitations: z.array(z.string()),
  status: AssertionStatusSchema,
  validFrom: TimestampSchema,
  validUntil: TimestampSchema.optional(),
});
export type SituationAssertion = z.infer<typeof SituationAssertionSchema>;

// ── Completion Facts ──
export const CompletionFactsSchema = z.object({
  requiredDeliverables: z.array(
    z.object({
      deliverableId: z.string(),
      description: z.string(),
      status: z.string(),
    }),
  ),
  openCriticalClaims: z.array(
    z.object({
      claimId: z.string(),
      text: z.string(),
      status: z.string(),
    }),
  ),
  unresolvedDecisions: z.array(z.string()),
  recentToolFailures: z.array(
    z.object({
      toolName: z.string(),
      error: z.string(),
      occurredAt: z.string(),
    }),
  ),
  evidenceGaps: z.array(
    z.object({
      claimId: z.string(),
      missingEvidenceType: z.string(),
    }),
  ),
});
export type CompletionFacts = z.infer<typeof CompletionFactsSchema>;
