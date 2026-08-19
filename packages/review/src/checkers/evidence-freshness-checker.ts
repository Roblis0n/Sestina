import type { ArgumentEvidence } from "@sestina/research";
import type { CheckerResult, ResearchChecker } from "../checker.js";
import { createFinding } from "../finding.js";
import type { ReviewContext } from "../review-context.js";
import { cloneReviewValue } from "../review-result.js";
import { findingIdFromFingerprint } from "./fingerprint.js";

export interface CurrentEvidenceRevision { readonly projectId: string; readonly artifactId: string; readonly revisionId: string; readonly contentHash: string; }
export interface EvidenceFreshnessIssue { readonly evidenceId: string; readonly reason: "revision_superseded" | "content_hash_mismatch" | "marked_stale"; readonly state: "stale"; }
export function evaluateEvidenceFreshness(evidence: readonly ArgumentEvidence[], current: readonly CurrentEvidenceRevision[]): readonly EvidenceFreshnessIssue[] {
  const issues: EvidenceFreshnessIssue[] = [];
  for (const item of evidence) {
    if (item.state === "stale") { issues.push({ evidenceId: item.id, reason: "marked_stale", state: "stale" }); continue; }
    if (item.artifactId === undefined || item.revisionId === undefined) continue;
    const binding = current.find((value) => value.projectId === item.projectId && value.artifactId === item.artifactId);
    if (binding?.revisionId !== item.revisionId) issues.push({ evidenceId: item.id, reason: "revision_superseded", state: "stale" });
    else if (item.contentVersionHash !== undefined && item.contentVersionHash !== binding.contentHash) issues.push({ evidenceId: item.id, reason: "content_hash_mismatch", state: "stale" });
  }
  return Object.freeze(issues.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
}

export class EvidenceFreshnessChecker implements ResearchChecker {
  readonly id = "evidence-freshness"; readonly version = "1.0.0"; readonly kind = "deterministic" as const;
  readonly #evidence: readonly ArgumentEvidence[]; readonly #current: readonly CurrentEvidenceRevision[];
  constructor(evidence: readonly ArgumentEvidence[], current: readonly CurrentEvidenceRevision[]) { this.#evidence = cloneReviewValue(evidence); this.#current = cloneReviewValue(current); }
  supports(): boolean { return true; }
  run(context: ReviewContext): Promise<CheckerResult> {
    const issues = evaluateEvidenceFreshness(this.#evidence, this.#current);
    const findings = issues.map((issue) => {
      const item = this.#evidence.find((value) => value.id === issue.evidenceId);
      const created = createFinding({ id: findingIdFromFingerprint({ checker: this.id, version: this.version, inputHash: context.inputHash, ...issue }), kind: "stale_evidence", severity: "error", target: item?.artifactId ? { kind: "artifact", artifactId: item.artifactId } : { kind: "project" }, baselineEvidence: [], candidateEvidence: [], briefVersionId: context.briefVersion.id, decisionIds: [], issueIds: [], checker: { id: this.id, version: this.version, kind: this.kind }, confidence: { source: "rule", value: 1 }, rationale: `Registered evidence is stale: ${issue.reason}`, minimumRecovery: "Rebind the evidence to the current revision or downgrade the claim", needsUserDecision: false, presentation: "foreground", provenance: { authority: "system_derived", inputHash: context.inputHash } });
      if (!created.ok) throw new Error("Evidence freshness Finding construction failed"); return created.value;
    });
    return Promise.resolve(cloneReviewValue({ findings, observations: issues.map((issue) => ({ code: issue.reason, message: `${issue.evidenceId} is stale` })) }));
  }
}
