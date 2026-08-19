import { parseResearchSource, validateUtcTimestamp, type ResearchSource } from "../authority/source.js";
import { cloneFrozen, isNonBlankString, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type IssueStatus = "open" | "acknowledged" | "resolved" | "suppressed" | "disputed" | "waived" | "reopened";
export const ISSUE_STATUSES: readonly IssueStatus[] = ["open", "acknowledged", "resolved", "suppressed", "disputed", "waived", "reopened"];
export interface IssueTransition { readonly from: IssueStatus | null; readonly to: IssueStatus; readonly reason: string; readonly source: ResearchSource; readonly at: string; }

export function parseIssueStatus(value: unknown): ResearchResult<IssueStatus> {
  return typeof value === "string" && ISSUE_STATUSES.includes(value as IssueStatus) ? ok(value as IssueStatus) : err(researchError("invalid_issue_transition"));
}
export function parseIssueTransition(input: unknown): ResearchResult<IssueTransition> {
  if (!isRecord(input) || !isNonBlankString(input.reason)) return err(researchError("invalid_issue_transition"));
  let from: IssueStatus | null;
  if (input.from === null) from = null;
  else { const parsed = parseIssueStatus(input.from); if (!parsed.ok) return parsed; from = parsed.value; }
  const to = parseIssueStatus(input.to); if (!to.ok) return to;
  const source = parseResearchSource(input.source); if (!source.ok) return source;
  const at = validateUtcTimestamp(input.at); if (!at.ok) return at;
  return ok(cloneFrozen({ from, to: to.value, reason: input.reason.trim(), source: source.value, at: at.value }));
}
