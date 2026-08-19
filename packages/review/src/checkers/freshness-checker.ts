import { createFinding, type Finding } from "../finding.js";
import type { CheckerResult, ResearchChecker } from "../checker.js";
import type { ReviewContext } from "../review-context.js";
import { cloneReviewValue } from "../review-result.js";
import { findingIdFromFingerprint, reviewFingerprint } from "./fingerprint.js";
import { FRESHNESS_RATIONALE, FRESHNESS_RECOVERY, type FreshnessReason } from "./freshness-reasons.js";

export interface FreshnessObservation {
  readonly currentBriefVersionId?: string;
  readonly artifactActiveRevisionId?: string;
  readonly boundReportInputHash?: string;
  readonly availableCheckerVersions: readonly { readonly id: string; readonly version: string }[];
  readonly environmentFingerprint?: string;
  readonly buildFingerprint?: string;
}

export class FreshnessChecker implements ResearchChecker {
  readonly id = "freshness";
  readonly version = "1.0.0";
  readonly kind = "deterministic" as const;
  readonly #observation: FreshnessObservation;

  constructor(observation: FreshnessObservation) { this.#observation = cloneReviewValue(observation); }
  supports(): boolean { return true; }

  run(context: ReviewContext): Promise<CheckerResult> {
    const reasons: FreshnessReason[] = [];
    if (this.#observation.currentBriefVersionId !== context.briefVersion.id) reasons.push("brief_superseded");
    if (context.candidateRevision.parentRevisionId !== context.episode.baselineRevisionId) reasons.push("candidate_parent_mismatch");
    if (this.#observation.artifactActiveRevisionId !== context.candidateRevision.id) reasons.push("artifact_advanced");
    if (this.#observation.boundReportInputHash !== context.inputHash) reasons.push("review_input_mismatch");
    const checkerMissing = this.#observation.environmentFingerprint !== context.environmentFingerprint ||
      this.#observation.buildFingerprint !== context.buildFingerprint ||
      context.checkerSet.some((expected) => !this.#observation.availableCheckerVersions.some((actual) => actual.id === expected.id && actual.version === expected.version));
    if (checkerMissing) reasons.push("checker_version_missing");
    if (context.snapshot.projectId !== context.project.id || context.snapshot.episodeId !== context.episode.id || context.baselineRevision.projectId !== context.project.id || context.candidateRevision.projectId !== context.project.id) reasons.push("cross_project_reference");

    const findings: Finding[] = reasons.map((reason) => {
      const created = createFinding({
        id: findingIdFromFingerprint({ checker: this.id, version: this.version, inputHash: context.inputHash, observation: reviewFingerprint(this.#observation), reason }),
        kind: reason,
        severity: reason === "cross_project_reference" ? "critical" : "error",
        target: reason === "candidate_parent_mismatch" || reason === "artifact_advanced" ? { kind: "artifact", artifactId: context.episode.artifactId } : { kind: "project" },
        baselineEvidence: [], candidateEvidence: [], briefVersionId: context.briefVersion.id,
        decisionIds: context.activeDecisions.map((item) => item.id), issueIds: context.relevantIssues.map((item) => item.id),
        checker: { id: this.id, version: this.version, kind: this.kind }, confidence: { source: "rule", value: 1 },
        rationale: FRESHNESS_RATIONALE[reason], minimumRecovery: FRESHNESS_RECOVERY[reason],
        needsUserDecision: false, presentation: "foreground", provenance: { authority: "system_derived", inputHash: context.inputHash },
      });
      if (!created.ok) throw new Error("Freshness Finding construction failed");
      return created.value;
    });
    return Promise.resolve(cloneReviewValue({
      findings,
      observations: reasons.length === 0
        ? [{ code: "freshness_current", message: "Review inputs remain current" }]
        : reasons.map((reason) => ({ code: reason, message: FRESHNESS_RATIONALE[reason] })),
    }));
  }
}
