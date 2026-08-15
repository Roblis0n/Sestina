import { z } from "zod";
import {
  EvidencePolicySchema,
  AuthorityPolicySchema,
  BudgetPolicySchema,
  AssumptionSchema,
  BoundarySchema,
} from "./contracts.js";

export const ContractTemplateKindSchema = z.enum(["research", "strategy", "software"]);
export type ContractTemplateKind = z.infer<typeof ContractTemplateKindSchema>;

/**
 * A confirmed project/user contract template. Template-provided values
 * always carry the "template" source tier when merged, and a template can
 * never create hard boundaries: its boundaries are soft/open and always
 * overridable (enforced by the refine).
 */
export const ContractTemplateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    templateId: z.string().min(1).max(100),
    kind: ContractTemplateKindSchema,
    name: z.string().min(1).max(200),
    defaults: z.object({
      evidencePolicy: EvidencePolicySchema,
      authority: AuthorityPolicySchema,
      budgets: BudgetPolicySchema,
      assumptions: z.array(AssumptionSchema).optional(),
      boundaries: z.array(BoundarySchema).optional(),
    }),
  })
  .refine(
    (t) =>
      !t.defaults.boundaries ||
      t.defaults.boundaries.every((b) => b.severity !== "hard" && b.overridable),
    { message: "template boundaries must be soft/open and overridable" },
  );
export type ContractTemplate = z.infer<typeof ContractTemplateSchema>;
