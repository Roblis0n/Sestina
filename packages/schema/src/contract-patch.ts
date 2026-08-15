import { z } from "zod";
import { ID_SCHEMA, ContractIdSchema, TaskIdSchema } from "./ids.js";
import { TimestampSchema } from "./common.js";
import {
  BoundaryOwnerSchema,
  SourceRefSchema,
  ScopeItemSchema,
  BoundarySchema,
  StopConditionSchema,
  AssumptionSchema,
  DeliverableSchema,
  SourceSpanSchema,
  ContractSourceTierSchema,
} from "./contracts.js";
import { HandoffPreauthorizationSchema } from "./collaboration-authority.js";

// ── Whitelisted field path ──
//
// Contract patches never use raw JSON Pointer. The path is a discriminated
// union over a whitelist of patchable scalar fields. Contract identity and
// task attribution (contractId, taskId, version, schemaVersion, timestamps)
// are intentionally absent: a patch can never rewrite ownership.
export const ContractFieldPathSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("title") }),
  z.object({
    section: z.literal("objective"),
    field: z.enum(["primary", "rationale", "priority", "successSignal"]),
  }),
  z.object({
    section: z.literal("budgets"),
    field: z.enum([
      "maxToolCallsPerTask",
      "maxProviderCallsPerTask",
      "maxJudgmentCostPerTask",
    ]),
  }),
  z.object({
    section: z.literal("authority"),
    field: z.enum([
      "executorCanChooseMethods",
      "executorCanProposeScope",
      "executorCanSelfReview",
      "overridesRequireUserConfirmation",
    ]),
  }),
  z.object({
    section: z.literal("evidencePolicy"),
    field: z.enum(["requireSourceForClaims", "minEvidenceLevel", "allowUserTestimony"]),
  }),
]);
export type ContractFieldPath = z.infer<typeof ContractFieldPathSchema>;

// ── Patch operations ──
//
// Each variant is strict: unknown keys are rejected instead of silently
// dropped, and `__proto__`/`constructor` cannot appear because the field
// names are fixed literals. Array items are addressed by identity
// (deliverableId / boundaryId / statement / condition), never by raw index.

// zod's .strict() only flags keys present in the parsed output, and its
// extra-key check skips prototype-chain names — but JSON.parse materializes
// "__proto__"/"constructor" as OWN keys. The preprocess guard refuses them
// on the raw input so untrusted input can never smuggle a polluted object
// through a patch. (zod v4 runs checks attached to a union only on the
// resolved member, where the extra key is already invisible — preprocess is
// the only place the raw envelope is observable.)
const FORBIDDEN_ENVELOPE_KEYS = new Set(["__proto__", "constructor"]);

function forbidForbiddenEnvelopeKeys(value: unknown, ctx: z.RefinementCtx): unknown {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_ENVELOPE_KEYS.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `forbidden key "${key}"`,
          path: [key],
          input: value,
        });
        return z.NEVER;
      }
    }
  }
  return value;
}

export const ContractPatchOperationSchema = z.preprocess(
  forbidForbiddenEnvelopeKeys,
  z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("set_field"),
      path: ContractFieldPathSchema,
      // The value is validated against the target field's schema when the
      // patch is applied (packages/contracts) — the path whitelist already
      // prevents writing anywhere else.
      value: z.unknown(),
      sourceSpan: SourceSpanSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("upsert_deliverable"),
      deliverable: DeliverableSchema,
      sourceSpan: SourceSpanSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("remove_deliverable"),
      deliverableId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_scope_in"),
      item: ScopeItemSchema,
      sourceSpan: SourceSpanSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_scope_out"),
      item: ScopeItemSchema,
      sourceSpan: SourceSpanSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("remove_scope_in"),
      statement: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      op: z.literal("remove_scope_out"),
      statement: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_boundary"),
      boundary: BoundarySchema,
      sourceSpan: SourceSpanSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("remove_boundary"),
      boundaryId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_stop_condition"),
      condition: StopConditionSchema,
      sourceSpan: SourceSpanSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("remove_stop_condition"),
      condition: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_assumption"),
      assumption: AssumptionSchema,
      sourceSpan: SourceSpanSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("remove_assumption"),
      statement: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      op: z.literal("append_correction_ref"),
      correctionId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_preauthorization"),
      preauthorization: HandoffPreauthorizationSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("supersede_preauthorization"),
      preauthorizationId: ID_SCHEMA,
    })
    .strict(),
]),
);
export type ContractPatchOperation = z.infer<typeof ContractPatchOperationSchema>;

// ── Material ambiguity ──
//
// Only ambiguities that would lead to materially different high-impact
// outcomes become MaterialAmbiguity. Methodological ambiguities stay as
// assumptions and are resolved by the executing agent.

export const MaterialAmbiguityKindSchema = z.enum([
  "conflicting_directives",
  "completion_criteria_unclear",
  "scope_boundary_unclear",
  "authority_unclear",
  "budget_unclear",
  "deliverable_unclear",
]);
export type MaterialAmbiguityKind = z.infer<typeof MaterialAmbiguityKindSchema>;

export const MaterialAmbiguitySchema = z.object({
  ambiguityId: ID_SCHEMA,
  kind: MaterialAmbiguityKindSchema,
  description: z.string().min(1).max(1000),
  excerpt: z.string().max(2000).optional(),
  sourceSpans: z.array(SourceSpanSchema).min(1),
  decisionRequired: z.boolean(),
});
export type MaterialAmbiguity = z.infer<typeof MaterialAmbiguitySchema>;

// ── Patch proposal ──
//
// Proposals come from exactly one source tier. Inferred proposals can
// never claim ownership above "inferred": they stay soft/open, overridable,
// and never create user authorization (enforced in packages/contracts when
// proposals are built and applied).

export const ContractPatchProposalSchema = z.preprocess(
  forbidForbiddenEnvelopeKeys,
  z
    .object({
      schemaVersion: z.literal("1.0.0"),
      proposalId: ID_SCHEMA,
      contractId: ContractIdSchema,
      taskId: TaskIdSchema,
      expectedVersion: z.number().int().positive(),
      operations: z.array(ContractPatchOperationSchema).min(1),
      sourceTier: ContractSourceTierSchema,
      owner: BoundaryOwnerSchema,
      sourceRefs: z.array(SourceRefSchema),
      ambiguities: z.array(MaterialAmbiguitySchema),
      createdAt: TimestampSchema,
    })
    .refine(
      (p) => p.sourceTier !== "inferred" || p.owner === "inferred",
      { message: "inferred proposals must have inferred ownership" },
    ),
);
export type ContractPatchProposal = z.infer<typeof ContractPatchProposalSchema>;
