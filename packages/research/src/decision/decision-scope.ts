import { cloneFrozen, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type DecisionScope =
  | { readonly kind: "project" }
  | { readonly kind: "artifact"; readonly artifactId: string }
  | { readonly kind: "brief"; readonly briefVersionId: string }
  | { readonly kind: "issue"; readonly issueId: string };

export function parseDecisionScope(input: unknown): ResearchResult<DecisionScope> {
  if (!isRecord(input)) return err(researchError("invalid_decision_scope"));
  if (input.kind === "project") return ok(cloneFrozen({ kind: "project" as const }));
  const config = input.kind === "artifact"
    ? { field: "artifactId", prefix: "rart_" as const }
    : input.kind === "brief"
      ? { field: "briefVersionId", prefix: "rbrf_" as const }
      : input.kind === "issue"
        ? { field: "issueId", prefix: "riss_" as const }
        : undefined;
  if (config === undefined) return err(researchError("invalid_decision_scope"));
  const id = parseResearchIdFor(input[config.field], config.prefix);
  if (!id.ok) return id;
  if (input.kind === "artifact") return ok(cloneFrozen({ kind: "artifact" as const, artifactId: id.value.id }));
  if (input.kind === "brief") return ok(cloneFrozen({ kind: "brief" as const, briefVersionId: id.value.id }));
  return ok(cloneFrozen({ kind: "issue" as const, issueId: id.value.id }));
}

export interface DecisionQueryContext {
  readonly projectId: string;
  readonly artifactId?: string;
  readonly briefVersionId?: string;
  readonly issueId?: string;
  readonly asOf?: string;
}

export function decisionScopeMatches(scope: DecisionScope, context: DecisionQueryContext): boolean {
  switch (scope.kind) {
    case "project": return true;
    case "artifact": return scope.artifactId === context.artifactId;
    case "brief": return scope.briefVersionId === context.briefVersionId;
    case "issue": return scope.issueId === context.issueId;
  }
}

export function decisionScopePriority(scope: DecisionScope): number {
  return scope.kind === "issue" ? 4 : scope.kind === "brief" ? 3 : scope.kind === "artifact" ? 2 : 1;
}
