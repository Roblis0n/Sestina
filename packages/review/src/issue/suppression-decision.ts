import { matchResearchIssue, type IssueReopenContext, type ResearchIssue, type ResearchIssueInput } from "@sestina/research";

export type IssueLookupResult = { readonly ok: true; readonly issues: readonly ResearchIssue[] } | { readonly ok: false };
export type SuppressionDecision =
  | { readonly kind: "new" }
  | { readonly kind: "same_open"; readonly issueId: string }
  | { readonly kind: "suppress"; readonly issueId: string }
  | { readonly kind: "eligible_reopen"; readonly issueId: string; readonly reasons: readonly string[] }
  | { readonly kind: "related_distinct"; readonly issueId: string; readonly distinction: string }
  | { readonly kind: "unknown"; readonly reason: "issue_lookup_failed" | "issue_match_failed" };

export function decideFindingSuppression(candidate: ResearchIssueInput, lookup: IssueLookupResult, context: IssueReopenContext): SuppressionDecision {
  if (!lookup.ok) return { kind: "unknown", reason: "issue_lookup_failed" };
  const matched = matchResearchIssue(candidate, lookup.issues, context);
  if (!matched.ok) return { kind: "unknown", reason: "issue_match_failed" };
  switch (matched.value.kind) {
    case "new": return { kind: "new" };
    case "same_open": return { kind: "same_open", issueId: matched.value.issueId };
    case "suppressed_resolved": return { kind: "suppress", issueId: matched.value.issueId };
    case "eligible_to_reopen": return { kind: "eligible_reopen", issueId: matched.value.issueId, reasons: matched.value.reasons };
    case "related_but_distinct": return { kind: "related_distinct", issueId: matched.value.issueId, distinction: matched.value.distinction };
  }
}
