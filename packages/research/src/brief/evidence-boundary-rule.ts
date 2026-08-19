import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { parseScopeRule, type ScopeRule } from "./scope-rule.js";

export type ForbiddenInferenceKind = "causal" | "generalization" | "normative";
export interface EvidenceBoundaryRule {
  readonly id: string;
  readonly scope: ScopeRule;
  readonly statement: string;
  readonly allowedSourceIds?: readonly string[];
  readonly forbiddenInferenceKinds: readonly ForbiddenInferenceKind[];
}
const INFERENCE_KINDS: readonly ForbiddenInferenceKind[] = ["causal", "generalization", "normative"];

export function parseEvidenceBoundaryRule(input: unknown): ResearchResult<EvidenceBoundaryRule> {
  if (!isRecord(input) || !isNonBlankString(input.statement) || !Array.isArray(input.forbiddenInferenceKinds)) return err(researchError("invalid_evidence_boundary"));
  const id = parseResearchIdFor(input.id, "rbrf_"); if (!id.ok) return id;
  const scope = parseScopeRule(input.scope); if (!scope.ok) return scope;
  const forbiddenInferenceKinds: ForbiddenInferenceKind[] = [];
  for (const value of input.forbiddenInferenceKinds) {
    if (typeof value !== "string" || !INFERENCE_KINDS.includes(value as ForbiddenInferenceKind) || forbiddenInferenceKinds.includes(value as ForbiddenInferenceKind)) return err(researchError("invalid_evidence_boundary"));
    forbiddenInferenceKinds.push(value as ForbiddenInferenceKind);
  }
  let allowedSourceIds: string[] | undefined;
  if (input.allowedSourceIds !== undefined) {
    if (!Array.isArray(input.allowedSourceIds)) return err(researchError("invalid_evidence_boundary"));
    allowedSourceIds = [];
    for (const value of input.allowedSourceIds) {
      if (!isNonBlankString(value) || allowedSourceIds.includes(value)) return err(researchError("invalid_evidence_boundary"));
      allowedSourceIds.push(value);
    }
  }
  return ok(cloneFrozen({ id: id.value.id, scope: scope.value, statement: input.statement.trim(), ...(allowedSourceIds ? { allowedSourceIds } : {}), forbiddenInferenceKinds }));
}
