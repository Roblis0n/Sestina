import { z } from "zod";
import { TaskIdSchema } from "./ids.js";
import { TimestampSchema } from "./common.js";

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

// Re-exports from assertions.ts
export {
  AssertionKindSchema,
  type AssertionKind,
  AssertionStatusSchema,
  type AssertionStatus,
  SituationAssertionSchema,
  type SituationAssertion,
} from "./assertions.js";

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
