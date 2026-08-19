import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  calculateReviewInputHash,
  createFinding,
  deriveCoverage,
  deriveReviewObligations,
  deriveReviewOutcome,
  parseReviewContext,
  type CoverageStatus,
  type Finding,
  type ReviewContext,
  type ReviewObligation,
} from "../src/index.js";

const ids = new SequenceIdFactory(7000);
const projectId = ids.create("rprj_"); const episodeId = ids.create("repi_"); const artifactId = ids.create("rart_");
const baselineId = ids.create("rrev_"); const candidateId = ids.create("rrev_"); const briefId = ids.create("rbrf_"); const snapshotId = ids.create("rsnp_");
const decisionId = ids.create("rdec_"); const issueId = ids.create("riss_"); const boundaryId = ids.create("rbrf_");

function context(): ReviewContext {
  const input = {
    project: { id: projectId, version: 1 }, episode: { id: episodeId, version: 2, artifactId, baselineRevisionId: baselineId, candidateRevisionId: candidateId },
    baselineRevision: { id: baselineId, artifactId, projectId, contentHash: "a".repeat(64) }, candidateRevision: { id: candidateId, artifactId, projectId, parentRevisionId: baselineId, contentHash: "b".repeat(64) },
    briefVersion: { id: briefId, versionNumber: 1 }, activeDecisions: [{ id: decisionId, version: 1, status: "frozen" as const }], relevantIssues: [{ id: issueId, version: 2, status: "resolved" }], evidenceBoundaries: [{ id: boundaryId, statement: "No causal claim without design evidence" }],
    snapshot: { id: snapshotId, projectId, episodeId, hash: "c".repeat(64) }, checkerSet: [{ id: "scope", version: "1", kind: "deterministic" as const }], environmentFingerprint: "d".repeat(64), buildFingerprint: "e".repeat(64),
  };
  const parsed = parseReviewContext({ ...input, inputHash: calculateReviewInputHash(input) }); if (!parsed.ok) throw new Error(parsed.error.code); return parsed.value;
}

const obligation: ReviewObligation = { id: "obligation-1", dimension: "scope", criterion: "Stay in scope", source: { kind: "brief", id: briefId }, required: true };

function finding(kind: string, presentation: "foreground" | "audit_only" | "suppressed" = "foreground", severity: "info" | "warning" | "error" | "critical" = "error"): Finding {
  const ctx = context(); const value = createFinding({
    id: new SequenceIdFactory(kind.length + presentation.length + severity.length + 7100).create("rfnd_"), kind, severity,
    target: { kind: "artifact", artifactId }, baselineEvidence: [], candidateEvidence: [], briefVersionId: briefId,
    decisionIds: [], issueIds: [], checker: { id: "scope", version: "1", kind: "deterministic" }, confidence: { source: "rule", value: 1 },
    rationale: `Finding ${kind}`, minimumRecovery: "Repair the obligation", needsUserDecision: false, presentation,
    provenance: { authority: "system_derived", inputHash: ctx.inputHash },
  }); if (!value.ok) throw new Error(value.error.code); return value.value;
}

describe("orthogonal obligation coverage truth table", () => {
  const table: readonly [CoverageStatus, boolean, number][] = [
    ["checked_satisfied", true, 1], ["checked_violated", false, 0], ["unproven", false, 0],
    ["not_applicable", true, 0], ["waived", true, 0], ["stale", false, 0],
    ["disputed", false, 0], ["checker_failed", false, 0],
  ];
  it.each(table)("keeps %s explicit (reviewReady=%s)", (status, reviewReady, satisfiedCount) => {
    const coverage = deriveCoverage([obligation], [{ obligationId: obligation.id, status, findingIds: [] }], []);
    const outcome = deriveReviewOutcome({ obligations: [obligation], coverage, findings: [], expectedCheckerIds: ["scope"], failedCheckerIds: [], userDisposition: "pending" });
    expect(outcome.reviewReady).toBe(reviewReady);
    expect(outcome.dimensions.scope.coverage[0]?.status).toBe(status);
    expect(outcome.dimensions.scope.satisfiedCount).toBe(satisfiedCount);
  });

  it("derives obligations only from Brief, Decision, Issue and explicit user checks", () => {
    const obligations = deriveReviewObligations(context(), [{ id: "user-check-1", dimension: "fulfillment", criterion: "Verify requested appendix" }]);
    expect(new Set(obligations.map((item) => item.source.kind))).toEqual(new Set(["brief", "decision", "issue", "user"]));
    expect(obligations.some((item) => item.criterion === "Verify requested appendix")).toBe(true);
  });

  it("keeps scope violation and checker failure independently blocking", () => {
    const scopeFinding = finding("scope_violation"); const error = finding("checker_error", "audit_only");
    const coverage = deriveCoverage([obligation], [{ obligationId: obligation.id, status: "checked_violated", findingIds: [scopeFinding.id] }], [scopeFinding, error]);
    const outcome = deriveReviewOutcome({ obligations: [obligation], coverage, findings: [scopeFinding, error], expectedCheckerIds: ["scope", "semantic"], failedCheckerIds: ["semantic"], userDisposition: "pending" });
    expect(outcome.reviewReady).toBe(false);
    expect(outcome.dimensions.scope.coverage[0]?.status).toBe("checked_violated");
    expect(outcome.checkerHealth.status).toBe("checker_failed");
    expect(outcome.checkerHealth.failedCheckerIds).toContain("semantic");
  });

  it("keeps disputed fact even when the user accepts and a low severity Finding exists", () => {
    const low = finding("minor_note", "foreground", "info");
    const coverage = deriveCoverage([obligation], [{ obligationId: obligation.id, status: "disputed", findingIds: [] }], [low]);
    const outcome = deriveReviewOutcome({ obligations: [obligation], coverage, findings: [low], expectedCheckerIds: ["scope"], failedCheckerIds: [], userDisposition: "accepted" });
    expect(outcome.reviewReady).toBe(false);
    expect(outcome.userDisposition).toBe("accepted");
    expect(outcome.dimensions.scope.coverage[0]?.status).toBe("disputed");
  });

  it("retains waived and not-applicable coverage without counting either as passed", () => {
    const second = { ...obligation, id: "obligation-2", dimension: "evidence" as const };
    const coverage = deriveCoverage([obligation, second], [
      { obligationId: obligation.id, status: "waived", findingIds: [] },
      { obligationId: second.id, status: "not_applicable", findingIds: [] },
    ], []);
    const outcome = deriveReviewOutcome({ obligations: [obligation, second], coverage, findings: [], expectedCheckerIds: [], failedCheckerIds: [], userDisposition: "waived" });
    expect(outcome.dimensions.scope).toMatchObject({ satisfiedCount: 0, waivedCount: 1, notApplicableCount: 0 });
    expect(outcome.dimensions.evidence).toMatchObject({ satisfiedCount: 0, waivedCount: 0, notApplicableCount: 1 });
  });

  it("conservatively fills missing coverage as unproven and ignores unrelated suppressed findings", () => {
    const suppressed = finding("repeated_audit", "suppressed");
    const coverage = deriveCoverage([obligation], [], [suppressed]);
    expect(coverage).toEqual([expect.objectContaining({ obligationId: obligation.id, status: "unproven", findingIds: [] })]);
    const outcome = deriveReviewOutcome({ obligations: [obligation], coverage, findings: [suppressed], expectedCheckerIds: ["scope"], failedCheckerIds: [], userDisposition: "pending" });
    expect(outcome.dimensions.scope.findingIds).toEqual([]);
    expect(outcome.auditFindingIds).toEqual([suppressed.id]);
  });

  it("reports a missing expected checker as checker_failed rather than satisfied", () => {
    const coverage = deriveCoverage([obligation], [{ obligationId: obligation.id, status: "checked_satisfied", findingIds: [] }], []);
    const outcome = deriveReviewOutcome({ obligations: [obligation], coverage, findings: [], expectedCheckerIds: ["scope"], completedCheckerIds: [], failedCheckerIds: [], userDisposition: "pending" });
    expect(outcome.reviewReady).toBe(false);
    expect(outcome.checkerHealth).toMatchObject({ status: "checker_failed", missingCheckerIds: ["scope"] });
  });
});
