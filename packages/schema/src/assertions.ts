import { z } from "zod";
import { ProjectIdSchema, TaskIdSchema } from "./ids.js";
import { TimestampSchema } from "./common.js";

// ── Assertion Kinds ──
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

// ── Situation Assertion ──
export const SituationAssertionSchema = z.object({
  assertionId: z.string(),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema.optional(),
  kind: AssertionKindSchema,
  statement: z.string().min(1).max(3000),
  sourceRefs: z.array(z.record(z.string(), z.unknown())),
  confidence: z.number().min(0).max(1).optional(),
  limitations: z.array(z.string()),
  status: AssertionStatusSchema,
  validFrom: TimestampSchema,
  validUntil: TimestampSchema.optional(),
});
export type SituationAssertion = z.infer<typeof SituationAssertionSchema>;
