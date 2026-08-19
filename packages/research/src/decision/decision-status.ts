import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type DecisionStatus = "proposed" | "accepted" | "frozen" | "rejected" | "deferred" | "superseded";
export const DECISION_STATUSES: readonly DecisionStatus[] = ["proposed", "accepted", "frozen", "rejected", "deferred", "superseded"];

export function parseDecisionStatus(value: unknown): ResearchResult<DecisionStatus> {
  return typeof value === "string" && DECISION_STATUSES.includes(value as DecisionStatus)
    ? ok(value as DecisionStatus)
    : err(researchError("invalid_decision_status"));
}
