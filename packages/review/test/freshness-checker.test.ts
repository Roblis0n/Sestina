import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  FreshnessChecker,
  calculateReviewInputHash,
  parseReviewContext,
  type FreshnessObservation,
  type ReviewContext,
} from "../src/index.js";

const ids = new SequenceIdFactory(4000);
const projectId = ids.create("rprj_");
const episodeId = ids.create("repi_");
const artifactId = ids.create("rart_");
const baselineId = ids.create("rrev_");
const candidateId = ids.create("rrev_");
const briefId = ids.create("rbrf_");
const snapshotId = ids.create("rsnp_");

function reviewContext(overrides: Record<string, unknown> = {}): ReviewContext {
  const base = {
    project: { id: projectId, version: 1 },
    episode: { id: episodeId, version: 2, artifactId, baselineRevisionId: baselineId, candidateRevisionId: candidateId },
    baselineRevision: { id: baselineId, artifactId, projectId, contentHash: "a".repeat(64) },
    candidateRevision: { id: candidateId, artifactId, projectId, parentRevisionId: baselineId, contentHash: "b".repeat(64) },
    briefVersion: { id: briefId, versionNumber: 1 }, activeDecisions: [], relevantIssues: [], evidenceBoundaries: [],
    snapshot: { id: snapshotId, projectId, episodeId, hash: "c".repeat(64) },
    checkerSet: [{ id: "freshness", version: "1.0.0", kind: "deterministic" as const }],
    environmentFingerprint: "d".repeat(64), buildFingerprint: "e".repeat(64),
    ...overrides,
  };
  const parsed = parseReviewContext({ ...base, inputHash: calculateReviewInputHash(base) });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

function observation(context: ReviewContext): FreshnessObservation {
  return {
    currentBriefVersionId: context.briefVersion.id,
    artifactActiveRevisionId: context.candidateRevision.id,
    boundReportInputHash: context.inputHash,
    availableCheckerVersions: context.checkerSet.map(({ id, version }) => ({ id, version })),
    environmentFingerprint: context.environmentFingerprint,
    buildFingerprint: context.buildFingerprint,
  };
}

describe("FreshnessChecker", () => {
  const cases: readonly [string, (input: { context: ReviewContext; value: FreshnessObservation }) => { context?: ReviewContext; observation?: FreshnessObservation }][] = [
    ["brief_superseded", ({ value }) => ({ observation: { ...value, currentBriefVersionId: ids.create("rbrf_") } })],
    ["candidate_parent_mismatch", ({ context }) => ({ context: reviewContext({ candidateRevision: { ...context.candidateRevision, parentRevisionId: ids.create("rrev_") } }) })],
    ["artifact_advanced", ({ value }) => ({ observation: { ...value, artifactActiveRevisionId: ids.create("rrev_") } })],
    ["review_input_mismatch", ({ value }) => ({ observation: { ...value, boundReportInputHash: "f".repeat(64) } })],
    ["checker_version_missing", ({ value }) => ({ observation: { ...value, availableCheckerVersions: [], environmentFingerprint: undefined } })],
    ["cross_project_reference", ({ context }) => ({ context: reviewContext({ snapshot: { ...context.snapshot, projectId: ids.create("rprj_") } }) })],
  ];

  it.each(cases)("emits the specific %s reason and remains deterministic", async (reason, mutate) => {
    const original = reviewContext();
    const changed = mutate({ context: original, value: observation(original) });
    const context = changed.context ?? original;
    const checker = new FreshnessChecker(changed.observation ?? observation(context));
    const first = await checker.run(context);
    const second = await checker.run(context);
    expect(first).toEqual(second);
    expect(first.findings.map((finding) => finding.kind)).toContain(reason);
    expect(first.findings.find((finding) => finding.kind === reason)?.minimumRecovery).toMatch(/refresh|re-run|rebind/i);
  });

  it("preserves every simultaneous reason", async () => {
    const context = reviewContext({ snapshot: { id: snapshotId, projectId: ids.create("rprj_"), episodeId, hash: "c".repeat(64) } });
    const value = observation(context);
    const result = await new FreshnessChecker({ ...value, currentBriefVersionId: ids.create("rbrf_"), artifactActiveRevisionId: ids.create("rrev_"), boundReportInputHash: "0".repeat(64), availableCheckerVersions: [] }).run(context);
    expect(new Set(result.findings.map((finding) => finding.kind))).toEqual(new Set(["brief_superseded", "artifact_advanced", "review_input_mismatch", "checker_version_missing", "cross_project_reference"]));
  });

  it("returns an explicit healthy observation with no stale Finding", async () => {
    const context = reviewContext();
    const result = await new FreshnessChecker(observation(context)).run(context);
    expect(result.findings).toEqual([]);
    expect(result.observations).toEqual([{ code: "freshness_current", message: "Review inputs remain current" }]);
  });
});
