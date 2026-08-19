import { createResearchDecision, type ResearchDecision, type ResearchSource } from "@sestina/research";
import { CorrectionSchema } from "@sestina/schema";
import type { LegacyCorrectionRow } from "./types.js";

export function mapLegacyCorrection(
  row: LegacyCorrectionRow,
  ids: { readonly projectId: string; readonly decisionId: string; readonly briefVersionId: string },
  source: ResearchSource,
): ResearchDecision | undefined {
  let raw: unknown;
  try { raw = JSON.parse(row.data); } catch { return undefined; }
  const correction = CorrectionSchema.safeParse(raw);
  if (!correction.success) return undefined;
  const result = createResearchDecision({
    projectId: ids.projectId,
    statement: correction.data.summary,
    scope: { kind: "project" },
    rationale: correction.data.normalizedInstruction,
    effectiveBriefVersionId: ids.briefVersionId,
    reopenConditions: ["User reviews the imported correction candidate"],
    source,
  }, {
    clock: { now: () => new Date(correction.data.createdAt) },
    idFactory: { create: () => ids.decisionId },
  });
  return result.ok ? result.value : undefined;
}
