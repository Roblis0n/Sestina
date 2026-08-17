import { z } from "zod";
import { ProjectIdSchema, TaskIdSchema } from "./ids.js";
import { TimestampSchema, ActorProvenanceSchema, canActAsDirectUser } from "./common.js";

export const MAX_ASSERTION_SOURCE_REFS = 32;
export const MAX_ASSERTION_LIMITATIONS = 32;
export const MAX_ASSERTION_CONFIRMATIONS = 32;

// ── Assertion Kinds ──
// The six kinds are never mixed: an assertion is exactly one of these, and
// only `confirm` with a legal ConfirmationSource can ever produce
// confirmed_fact (docs/09 §15, docs/22 Task 10).
export const AssertionKindSchema = z.enum([
  "confirmed_fact",
  "reported_fact",
  "inference",
  "assumption",
  "unknown",
  "unavailable",
]);
export type AssertionKind = z.infer<typeof AssertionKindSchema>;

// ── Assertion Status ──
export const AssertionStatusSchema = z.enum([
  "active",
  "disputed",
  "superseded",
  "expired",
]);
export type AssertionStatus = z.infer<typeof AssertionStatusSchema>;

// ── Typed source references ──
// A sourceRef names WHERE a statement came from. The legacy loose
// record<string, unknown> shape is gone: every ref is typed and traceable.
export const AssertionSourceRefSchema = z.object({
  refType: z.enum([
    "evidence",
    "tool_result",
    "hook_observation",
    "user_statement",
    "judge_opinion",
    "host_event",
  ]),
  refId: z.string().min(1).max(200),
  excerpt: z.string().max(2000).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type AssertionSourceRef = z.infer<typeof AssertionSourceRefSchema>;

// ── Structured missing reasons ──
// unknown/unavailable assertions must say WHAT is missing and WHY it could
// not be observed - never a bare "we do not know".
export const MissingReasonSchema = z.object({
  reasonKind: z.enum([
    "information_missing",
    "source_unreachable",
    "host_capability_limited",
    "not_resolvable",
  ]),
  description: z.string().min(1).max(2000),
});
export type MissingReason = z.infer<typeof MissingReasonSchema>;

// ── Confirmation sources ──
// The closed union of what can confirm a fact. A judge opinion/inference is
// a recordable source but NEVER a confirming one: high confidence is still
// an inference (see validConfirmationSources and the schema refine).
export const VerifiedEvidenceConfirmationSchema = z.object({
  sourceType: z.literal("verified_evidence"),
  evidenceId: z.string().min(1).max(64),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type VerifiedEvidenceConfirmation = z.infer<typeof VerifiedEvidenceConfirmationSchema>;

export const ToolResultConfirmationSchema = z.object({
  sourceType: z.literal("tool_result"),
  refId: z.string().min(1).max(200),
  trusted: z.boolean(),
});
export type ToolResultConfirmation = z.infer<typeof ToolResultConfirmationSchema>;

export const HookObservationConfirmationSchema = z.object({
  sourceType: z.literal("hook_observation"),
  refId: z.string().min(1).max(200),
  trusted: z.boolean(),
});
export type HookObservationConfirmation = z.infer<typeof HookObservationConfirmationSchema>;

export const DirectUserConfirmationSchema = z.object({
  sourceType: z.literal("direct_user"),
  provenance: ActorProvenanceSchema,
});
export type DirectUserConfirmation = z.infer<typeof DirectUserConfirmationSchema>;

export const JudgeOpinionConfirmationSchema = z.object({
  sourceType: z.literal("judge_opinion"),
  refId: z.string().min(1).max(200),
});
export type JudgeOpinionConfirmation = z.infer<typeof JudgeOpinionConfirmationSchema>;

export const ConfirmationSourceSchema = z.discriminatedUnion("sourceType", [
  VerifiedEvidenceConfirmationSchema,
  ToolResultConfirmationSchema,
  HookObservationConfirmationSchema,
  DirectUserConfirmationSchema,
  JudgeOpinionConfirmationSchema,
]);
export type ConfirmationSource = z.infer<typeof ConfirmationSourceSchema>;

/**
 * True when at least one confirmation comes from a source that is legally
 * allowed to confirm a fact: verified evidence, a trusted tool result or
 * hook observation, or a direct user. Judge opinions and untrusted tool
 * results are recorded but never confirm - this is the single rule shared
 * by the schema refine and the SituationService.
 */
export function validConfirmationSources(confirmations: readonly ConfirmationSource[]): boolean {
  return confirmations.some((confirmation) => {
    switch (confirmation.sourceType) {
      case "verified_evidence":
        return true;
      case "tool_result":
      case "hook_observation":
        return confirmation.trusted;
      case "direct_user":
        return canActAsDirectUser(confirmation.provenance);
      case "judge_opinion":
        return false;
    }
  });
}

// ── Situation Assertion ──
export const SituationAssertionSchema = z
  .object({
    assertionId: z.string().min(1).max(64),
    projectId: ProjectIdSchema,
    taskId: TaskIdSchema.optional(),
    kind: AssertionKindSchema,
    statement: z.string().min(1).max(3000),
    sourceRefs: z.array(AssertionSourceRefSchema).min(1).max(MAX_ASSERTION_SOURCE_REFS),
    confidence: z.number().min(0).max(1).optional(),
    limitations: z.array(z.string().max(2000)).max(MAX_ASSERTION_LIMITATIONS),
    /** Required for unknown/unavailable: what is missing and why. */
    missingReason: MissingReasonSchema.optional(),
    /** Recorded confirmations; a confirmed_fact requires a legal one. */
    confirmations: z.array(ConfirmationSourceSchema).max(MAX_ASSERTION_CONFIRMATIONS).optional(),
    status: AssertionStatusSchema,
    /** Who recorded this assertion and through which channel. */
    provenance: ActorProvenanceSchema,
    createdAt: TimestampSchema,
    /** Set on the NEW record when this assertion is superseded (append-only). */
    supersededBy: z.string().min(1).max(64).optional(),
    /** CAS version for optimistic concurrency on confirmation/status changes. */
    version: z.number().int().min(1),
    validFrom: TimestampSchema,
    validUntil: TimestampSchema.optional(),
  })
  .refine((data) => data.kind !== "unknown" && data.kind !== "unavailable"
    ? true
    : data.missingReason !== undefined, {
    message: "unknown/unavailable assertions require a structured missingReason",
  })
  .refine((data) => data.kind !== "confirmed_fact"
    ? true
    : validConfirmationSources(data.confirmations ?? []), {
    message:
      "a confirmed_fact requires a legal confirmation source (verified evidence, trusted tool result/hook observation, or direct user); a judge opinion can never confirm",
  });
export type SituationAssertion = z.infer<typeof SituationAssertionSchema>;
