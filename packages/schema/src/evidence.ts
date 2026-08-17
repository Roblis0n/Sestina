import { z } from "zod";
import { TaskIdSchema } from "./ids.js";
import { TimestampSchema, ActorProvenanceSchema, canActAsDirectUser } from "./common.js";

// SHA-256 content hashes are always lowercase 64-char hex.
const SHA256_HEX = /^[a-f0-9]{64}$/;
export const MAX_CLAIM_EVIDENCE_REFS = 128;
export const MAX_CLAIM_LIMITATIONS = 64;
export const MAX_DELIVERABLE_EVIDENCE_REFS = 128;
export const MAX_COMPLETION_DELIVERABLES = 5_000;
export const MAX_COMPLETION_OPEN_CLAIMS = 20;
export const MAX_COMPLETION_DECISIONS = 20;
export const MAX_COMPLETION_TOOL_FAILURES = 10;
export const MAX_COMPLETION_EVIDENCE_GAPS = 20;

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
  value: z.string().min(1).max(4000),
  lineRange: z
    .object({
      start: z.number().int().positive().optional(),
      end: z.number().int().positive().optional(),
    })
    .optional(),
  contentHash: z.string().regex(SHA256_HEX).optional(),
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
  evidenceId: z.string().min(1).max(64),
  taskId: TaskIdSchema,
  type: EvidenceTypeSchema,
  locator: EvidenceLocatorSchema,
  excerpt: z.string().max(5000).optional(),
  contentHash: z.string().regex(SHA256_HEX).optional(),
  status: EvidenceStatusSchema,
  provenance: z.string().max(2000),
  recordedBy: z.enum(["user", "agent", "hook", "import"]),
  observedAt: TimestampSchema.optional(),
  expiresAt: TimestampSchema.optional(),
  /** CAS version for optimistic concurrency on status transitions. */
  version: z.number().int().min(1),
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
  claimId: z.string().min(1).max(64),
  taskId: TaskIdSchema,
  text: z.string().min(1).max(5000),
  type: ClaimTypeSchema,
  importance: ClaimImportanceSchema,
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string().min(1).max(64)).max(MAX_CLAIM_EVIDENCE_REFS),
  status: ClaimStatusSchema,
  limitations: z.array(z.string().max(2000)).max(MAX_CLAIM_LIMITATIONS),
  /** Who recorded the claim and through which channel. */
  provenance: ActorProvenanceSchema,
  createdAt: TimestampSchema,
  /** Last status recompute time; status history is append-only in storage. */
  assessedAt: TimestampSchema.optional(),
  /** CAS version for optimistic concurrency on status recomputes. */
  version: z.number().int().min(1),
});
export type Claim = z.infer<typeof ClaimSchema>;

// ── Claim-evidence links ──
// Machine-decidable relation and strength: the pair (relation, strength) is
// what the claim status machine consumes - correlational-only evidence never
// supports a causal claim beyond partially_supported.
export const ClaimEvidenceRelationSchema = z.enum(["supports", "contradicts", "context"]);
export type ClaimEvidenceRelation = z.infer<typeof ClaimEvidenceRelationSchema>;

export const ClaimEvidenceStrengthSchema = z.enum(["causal", "correlational", "reported", "unknown"]);
export type ClaimEvidenceStrength = z.infer<typeof ClaimEvidenceStrengthSchema>;

export const ClaimEvidenceLinkSchema = z.object({
  claimId: z.string().min(1).max(64),
  evidenceId: z.string().min(1).max(64),
  relation: ClaimEvidenceRelationSchema,
  strength: ClaimEvidenceStrengthSchema,
  /** Authenticated actor that created this immutable authority link. */
  provenance: ActorProvenanceSchema,
  linkedAt: TimestampSchema,
});
export type ClaimEvidenceLink = z.infer<typeof ClaimEvidenceLinkSchema>;

// Re-exports from assertions.ts
export {
  AssertionKindSchema,
  type AssertionKind,
  AssertionStatusSchema,
  type AssertionStatus,
  SituationAssertionSchema,
  type SituationAssertion,
  AssertionSourceRefSchema,
  type AssertionSourceRef,
  MissingReasonSchema,
  type MissingReason,
  ConfirmationSourceSchema,
  type ConfirmationSource,
  validConfirmationSources,
} from "./assertions.js";

// ── Deliverable completion ledger ──
export const DeliverableLedgerStatusSchema = z.enum([
  "pending",
  "in_progress",
  "satisfied",
  "waived",
  "failed",
]);
export type DeliverableLedgerStatus = z.infer<typeof DeliverableLedgerStatusSchema>;

/**
 * A structured deliverable waiver: only a direct user (desktop/CLI channel)
 * can waive a deliverable, always with a reason and a time. Peers, agents,
 * hooks and MCP callers can never waive. The legacy `waivedBy: string` field
 * on DeliverableStatus exists for reading old rows only - it never satisfies
 * the waived state by itself.
 */
export const DeliverableWaiverSchema = z
  .object({
    reason: z.string().min(1).max(2000),
    provenance: ActorProvenanceSchema,
    waivedAt: TimestampSchema,
  })
  .refine((waiver) => canActAsDirectUser(waiver.provenance), {
    message: "only a direct user can waive a deliverable",
  });
export type DeliverableWaiver = z.infer<typeof DeliverableWaiverSchema>;

// Named distinctly from the contract-level DeliverableStatusSchema in
// contracts.ts: that enum is the contract's own view (not_started|blocked|...);
// this object is the completion-ledger entry with structured waiver
// provenance, evidence links and CAS versioning.
export const DeliverableLedgerEntrySchema = z
  .object({
    deliverableId: z.string().min(1).max(64),
    description: z.string().min(1).max(3000),
    status: DeliverableLedgerStatusSchema,
    /** Evidence links that justify the current status. */
    evidenceRefs: z.array(z.string().min(1).max(64)).max(MAX_DELIVERABLE_EVIDENCE_REFS),
    /** Whether the current contract requires this deliverable for completion. */
    required: z.boolean().default(true),
    /** False after a later contract revision removes the deliverable. */
    active: z.boolean().default(true),
    /** Required exactly when status is waived. */
    waiver: DeliverableWaiverSchema.optional(),
    /** Legacy string waiver author - read-only, never satisfies completion. */
    waivedBy: z.string().max(200).optional(),
    /** Contract version this ledger entry was last synced against. */
    contractVersion: z.number().int().min(1).optional(),
    /** CAS version for optimistic concurrency on status transitions. */
    version: z.number().int().min(1),
    updatedAt: TimestampSchema,
  })
  .refine((deliverable) => (deliverable.status === "waived") === (deliverable.waiver !== undefined), {
    message: "structured waiver metadata is present exactly when a deliverable is waived",
  });
export type DeliverableLedgerEntry = z.infer<typeof DeliverableLedgerEntrySchema>;

// ── Completion Facts ──
// Exactly five structured top-level fields (docs/22 Task 10): facts only,
// no allow_stop or policy decisions - those belong to Task 11.
export const UnresolvedDecisionSchema = z.object({
  decisionId: z.string().min(1).max(64),
  reasonCode: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
  neededSince: TimestampSchema,
});
export type UnresolvedDecision = z.infer<typeof UnresolvedDecisionSchema>;

export const ToolFailureSchema = z.object({
  eventId: z.string().min(1).max(64),
  toolName: z.string().min(1).max(200),
  error: z.string().min(1).max(2000),
  occurredAt: TimestampSchema,
});
export type ToolFailure = z.infer<typeof ToolFailureSchema>;

/** Completion loading only surfaces critical and material gaps. */
export const EvidenceGapSchema = z.object({
  claimId: z.string().min(1).max(64),
  claimImportance: ClaimImportanceSchema,
  missingEvidenceType: z.string().min(1).max(100),
});
export type EvidenceGap = z.infer<typeof EvidenceGapSchema>;

export const CompletionFactsSchema = z.object({
  requiredDeliverables: z.array(DeliverableLedgerEntrySchema).max(MAX_COMPLETION_DELIVERABLES),
  openCriticalClaims: z.array(ClaimSchema).max(MAX_COMPLETION_OPEN_CLAIMS),
  unresolvedDecisions: z.array(UnresolvedDecisionSchema).max(MAX_COMPLETION_DECISIONS),
  recentToolFailures: z.array(ToolFailureSchema).max(MAX_COMPLETION_TOOL_FAILURES),
  evidenceGaps: z.array(EvidenceGapSchema).max(MAX_COMPLETION_EVIDENCE_GAPS),
});
export type CompletionFacts = z.infer<typeof CompletionFactsSchema>;
