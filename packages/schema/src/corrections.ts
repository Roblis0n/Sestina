import { z } from "zod";
import { ID_SCHEMA, ProjectIdSchema, TaskIdSchema } from "./ids.js";
import { ActorProvenanceSchema, canActAsDirectUser, TimestampSchema } from "./common.js";
import { BoundarySchema } from "./contracts.js";

// ── Correction (docs/09 §10, docs/33 §7) ──

export const CorrectionScopeSchema = z.enum(["session", "task", "project", "user"]);
export type CorrectionScope = z.infer<typeof CorrectionScopeSchema>;

// The nine correction classes of docs/33 §7.
export const CorrectionFailureClassSchema = z.enum([
  "observation",
  "fact",
  "inference",
  "contract",
  "rule",
  "judge",
  "merge",
  "presentation",
  "host_association",
]);
export type CorrectionFailureClass = z.infer<typeof CorrectionFailureClassSchema>;

export const CorrectionSeveritySchema = z.enum(["minor", "moderate", "major", "critical"]);
export type CorrectionSeverity = z.infer<typeof CorrectionSeveritySchema>;

/**
 * A correction record. History is append-only: newer corrections link the
 * older record through `supersededBy` and never rewrite it. Only a direct
 * user can set `confirmed`. peer/MCP/host actors can only produce
 * unconfirmed candidates (enforced by the refine below).
 */
export const CorrectionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    correctionId: ID_SCHEMA,
    projectId: ProjectIdSchema,
    taskId: TaskIdSchema.optional(),
    scope: CorrectionScopeSchema,
    summary: z.string().min(1).max(2000),
    normalizedInstruction: z.string().min(1).max(2000),
    originalEventRef: z.string().min(1).max(200),
    failureClass: CorrectionFailureClassSchema,
    severity: CorrectionSeveritySchema,
    actor: ActorProvenanceSchema,
    confirmed: z.boolean(),
    recurrenceCount: z.number().int().nonnegative(),
    recurrenceFingerprint: z.string().min(1).max(128),
    expiresWhen: TimestampSchema.optional(),
    supersededBy: ID_SCHEMA.optional(),
    confirmedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
  })
  .refine((c) => !c.confirmed || canActAsDirectUser(c.actor), {
    message: "only a direct user can confirm a correction",
  });
export type Correction = z.infer<typeof CorrectionSchema>;

/**
 * Structured confirmation proposal for promoting a task-level correction
 * to project/user scope. Promotion never happens silently: the caller
 * always gets a new proposal the user must confirm separately.
 */
export const CorrectionPromotionSchema = z
  .object({
    promotionId: ID_SCHEMA,
    fromCorrectionId: ID_SCHEMA,
    fromScope: CorrectionScopeSchema,
    toScope: z.enum(["project", "user"]),
    proposedBoundary: BoundarySchema,
    requiresConfirmation: z.literal(true),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: TimestampSchema,
  })
  .strict();
export type CorrectionPromotion = z.infer<typeof CorrectionPromotionSchema>;
