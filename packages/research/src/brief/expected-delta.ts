import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { parseScopeRule, type ScopeRule } from "./scope-rule.js";

export interface ExpectedDelta {
  readonly id: string;
  readonly statement: string;
  readonly scope: ScopeRule;
}

export function parseExpectedDelta(input: unknown): ResearchResult<ExpectedDelta> {
  if (!isRecord(input) || !isNonBlankString(input.statement)) return err(researchError("invalid_expected_delta"));
  const id = parseResearchIdFor(input.id, "rbrf_"); if (!id.ok) return id;
  const scope = parseScopeRule(input.scope); if (!scope.ok) return scope;
  return ok(cloneFrozen({ id: id.value.id, statement: input.statement.trim(), scope: scope.value }));
}
