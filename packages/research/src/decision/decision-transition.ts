import { parseResearchSource, validateUtcTimestamp, type ResearchSource } from "../authority/source.js";
import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { parseDecisionStatus, type DecisionStatus } from "./decision-status.js";

export interface DecisionTransition {
  readonly from: DecisionStatus | null;
  readonly to: DecisionStatus;
  readonly reason: string;
  readonly source: ResearchSource;
  readonly at: string;
}

export function parseDecisionTransition(input: unknown): ResearchResult<DecisionTransition> {
  if (!isRecord(input) || !isNonBlankString(input.reason)) return err(researchError("invalid_decision_transition"));
  let from: DecisionStatus | null;
  if (input.from === null) from = null;
  else { const parsed = parseDecisionStatus(input.from); if (!parsed.ok) return parsed; from = parsed.value; }
  const to = parseDecisionStatus(input.to); if (!to.ok) return to;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const at = validateUtcTimestamp(input.at); if (!at.ok) return at;
  return ok(cloneFrozen({ from, to: to.value, reason: input.reason.trim(), source: source.value, at: at.value }));
}
