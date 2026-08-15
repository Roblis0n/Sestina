import { z } from "zod";
import { ID_SCHEMA, ProjectIdSchema, TaskIdSchema } from "./ids.js";
import { HOST_SCHEMA, ActorProvenanceSchema, canActAsDirectUser, TimestampSchema } from "./common.js";

// ── Handoff preauthorization (docs/42 §6.3) ──
//
// A confirmed precise preauthorization carried by the TaskContract. It is
// always confirmed by a direct user (desktop/CLI channel); peers can never
// confirm. Matching is all-fields: contractVersion, project/task, endpoint
// or host, deliverable IDs, project-relative path scope, action categories,
// deadline and budget. Any field outside the grant cannot auto-authorize.

export const HandoffActionCategorySchema = z.enum([
  "read",
  "write",
  "execute",
  "publish",
  "delete",
]);
export type HandoffActionCategory = z.infer<typeof HandoffActionCategorySchema>;

export const HandoffEndpointRefSchema = z.object({
  endpointId: ID_SCHEMA.optional(),
  host: HOST_SCHEMA,
});
export type HandoffEndpointRef = z.infer<typeof HandoffEndpointRefSchema>;

export const HandoffBudgetSchema = z.object({
  maxMessages: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().positive().optional(),
});
export type HandoffBudget = z.infer<typeof HandoffBudgetSchema>;

export const HandoffPreauthorizationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    preauthorizationId: ID_SCHEMA,
    projectId: ProjectIdSchema,
    taskId: TaskIdSchema,
    source: HandoffEndpointRefSchema,
    target: HandoffEndpointRefSchema,
    deliverableIds: z.array(z.string().min(1).max(100)),
    pathScope: z.array(z.string().min(1).max(1000)),
    actionCategories: z.array(HandoffActionCategorySchema),
    deadline: TimestampSchema.optional(),
    budget: HandoffBudgetSchema.optional(),
    confirmedBy: ActorProvenanceSchema,
    contractVersion: z.number().int().positive(),
    status: z.enum(["active", "superseded", "expired"]),
    supersededBy: ID_SCHEMA.optional(),
    confirmedAt: TimestampSchema,
  })
  .refine((p) => canActAsDirectUser(p.confirmedBy), {
    message: "handoff preauthorization must be confirmed by a direct user",
  });
export type HandoffPreauthorization = z.infer<typeof HandoffPreauthorizationSchema>;

// ── Authority resolution request/result (docs/42 §6.2) ──
//
// resolveCollaborationAuthority only resolves authorization evidence and
// returns authorized | needs_user_confirmation | no_authority. The final
// allow_queue|hold|refuse policy decision belongs to Task 11.

export const HandoffAuthorizationRequestSchema = z
  .object({
    projectId: ProjectIdSchema,
    taskId: TaskIdSchema,
    handoffRef: z.string().min(1).max(200),
    currentContractVersion: z.number().int().positive(),
    preauthorizations: z.array(HandoffPreauthorizationSchema),
    source: HandoffEndpointRefSchema,
    target: HandoffEndpointRefSchema,
    deliverableIds: z.array(z.string().min(1).max(100)),
    requestedPaths: z.array(z.string().min(1).max(1000)),
    actionCategories: z.array(HandoffActionCategorySchema),
    now: TimestampSchema,
    userConfirmation: z
      .object({
        userConfirmationId: ID_SCHEMA,
        confirmedBy: ActorProvenanceSchema,
        confirmedAt: TimestampSchema,
        messageRef: z.string().min(1).max(200),
      })
      .refine((c) => canActAsDirectUser(c.confirmedBy), {
        message: "user confirmation must come from a direct user",
      })
      .optional(),
  })
  .strict();
export type HandoffAuthorizationRequest = z.infer<typeof HandoffAuthorizationRequestSchema>;

export const CollaborationAuthorityResultSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("authorized"),
    by: z.enum(["preauthorization", "user_confirmation"]),
    preauthorizationId: ID_SCHEMA.optional(),
  }),
  z.object({
    decision: z.literal("needs_user_confirmation"),
    reasons: z.array(z.string().max(500)),
  }),
  z.object({
    decision: z.literal("no_authority"),
    reasons: z.array(z.string().max(500)),
  }),
]);
export type CollaborationAuthorityResult = z.infer<typeof CollaborationAuthorityResultSchema>;
