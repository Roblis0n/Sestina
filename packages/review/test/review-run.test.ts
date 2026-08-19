import { describe, expect, it } from "vitest";
import { SequenceIdFactory } from "@sestina/research";
import {
  CheckerRegistry,
  calculateReviewInputHash,
  createFinding,
  parseReviewContext,
  runReview,
  type CheckerResult,
  type Finding,
  type ResearchChecker,
  type ReviewContext,
} from "../src/index.js";

const ids = new SequenceIdFactory(2000);
const PROJECT_ID = ids.create("rprj_");
const EPISODE_ID = ids.create("repi_");
const ARTIFACT_ID = ids.create("rart_");
const BASELINE_ID = ids.create("rrev_");
const CANDIDATE_ID = ids.create("rrev_");
const BRIEF_ID = ids.create("rbrf_");
const SNAPSHOT_ID = ids.create("rsnp_");
const DECISION_ID = ids.create("rdec_");
const ISSUE_ID = ids.create("riss_");
const BOUNDARY_ID = ids.create("rbrf_");

function contextInput() {
  return {
    project: { id: PROJECT_ID, version: 3 },
    episode: {
      id: EPISODE_ID,
      version: 4,
      artifactId: ARTIFACT_ID,
      baselineRevisionId: BASELINE_ID,
      candidateRevisionId: CANDIDATE_ID,
    },
    baselineRevision: { id: BASELINE_ID, artifactId: ARTIFACT_ID, projectId: PROJECT_ID, contentHash: "a".repeat(64) },
    candidateRevision: { id: CANDIDATE_ID, artifactId: ARTIFACT_ID, projectId: PROJECT_ID, parentRevisionId: BASELINE_ID, contentHash: "b".repeat(64) },
    briefVersion: { id: BRIEF_ID, versionNumber: 2 },
    activeDecisions: [{ id: DECISION_ID, version: 1, status: "accepted" as const }],
    relevantIssues: [{ id: ISSUE_ID, version: 2, status: "resolved" as const }],
    evidenceBoundaries: [{ id: BOUNDARY_ID, statement: "No causal claim without design evidence" }],
    snapshot: { id: SNAPSHOT_ID, projectId: PROJECT_ID, episodeId: EPISODE_ID, hash: "c".repeat(64) },
    checkerSet: [
      { id: "alpha", version: "1.0.0", kind: "deterministic" as const },
      { id: "beta", version: "2.0.0", kind: "semantic" as const },
    ],
    environmentFingerprint: "d".repeat(64),
    buildFingerprint: "e".repeat(64),
  };
}

function context(checkerSet?: ReturnType<typeof contextInput>["checkerSet"]): ReviewContext {
  const base = contextInput();
  const input = checkerSet ? { ...base, checkerSet } : base;
  const parsed = parseReviewContext({ ...input, inputHash: calculateReviewInputHash(input) });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

function finding(checker: { id: string; version: string; kind: "deterministic" | "semantic" }, seed: number): Finding {
  const env = new SequenceIdFactory(seed);
  const result = createFinding({
    id: env.create("rfnd_"),
    kind: "test_finding",
    severity: "warning",
    target: { kind: "artifact", artifactId: ARTIFACT_ID },
    baselineEvidence: checker.kind === "semantic" ? [{ artifactId: ARTIFACT_ID, revisionId: BASELINE_ID, startLine: 1, endLine: 2, excerptHash: "f".repeat(64) }] : [],
    candidateEvidence: [{ artifactId: ARTIFACT_ID, revisionId: CANDIDATE_ID, startLine: 1, endLine: 2, excerptHash: "1".repeat(64) }],
    briefVersionId: BRIEF_ID,
    decisionIds: [], issueIds: [], checker,
    confidence: { source: checker.kind === "semantic" ? "model" : "rule", value: 1 },
    rationale: `${checker.id} found a bounded problem`,
    minimumRecovery: "Restore the affected statement",
    needsUserDecision: false,
    presentation: "foreground",
    provenance: { authority: "system_derived", inputHash: calculateReviewInputHash(contextInput()) },
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

class FakeChecker implements ResearchChecker {
  constructor(
    readonly id: string,
    readonly version: string,
    readonly kind: "deterministic" | "semantic",
    private readonly result: CheckerResult | Error,
    private readonly delay = 0,
  ) {}
  supports(): boolean { return true; }
  async run(): Promise<CheckerResult> {
    if (this.delay > 0) await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe("checker registry and ReviewRun", () => {
  it("rejects duplicate checker ID/version", () => {
    const checker = new FakeChecker("alpha", "1.0.0", "deterministic", { findings: [] });
    expect(() => new CheckerRegistry([checker, checker])).toThrowError(/duplicate/i);
  });

  it("merges sequential and parallel results into the same canonical run", async () => {
    const alpha = new FakeChecker("alpha", "1.0.0", "deterministic", { findings: [finding({ id: "alpha", version: "1.0.0", kind: "deterministic" }, 2100)] }, 15);
    const beta = new FakeChecker("beta", "2.0.0", "semantic", { findings: [finding({ id: "beta", version: "2.0.0", kind: "semantic" }, 2200)] });
    const registry = new CheckerRegistry([beta, alpha]);
    const ports = () => ({ clock: { now: () => new Date("2026-08-19T08:00:00.000Z") }, idFactory: new SequenceIdFactory(2300) });
    const sequential = await runReview(context(), registry, { ...ports(), mode: "sequential" });
    const parallel = await runReview(context(), registry, { ...ports(), mode: "parallel" });
    expect(sequential).toEqual(parallel);
    expect(sequential.ok && sequential.value.findings.map((item) => item.checker.id)).toEqual(["alpha", "beta"]);
  });

  it("retains successful findings when another checker throws", async () => {
    const alpha = new FakeChecker("alpha", "1.0.0", "deterministic", { findings: [finding({ id: "alpha", version: "1.0.0", kind: "deterministic" }, 2400)] });
    const beta = new FakeChecker("beta", "2.0.0", "semantic", new Error("private provider response"));
    const result = await runReview(context(), new CheckerRegistry([alpha, beta]), {
      clock: { now: () => new Date("2026-08-19T08:00:00.000Z") },
      idFactory: new SequenceIdFactory(2500), mode: "parallel",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed_with_checker_errors");
    expect(result.value.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ checker: expect.objectContaining({ id: "alpha" }) }),
      expect.objectContaining({ kind: "checker_error", checker: expect.objectContaining({ id: "beta" }) }),
    ]));
    expect(JSON.stringify(result)).not.toContain("private provider response");
  });

  it("fails a semantic finding without an evidence span closed as checker_error", async () => {
    const invalid = { ...finding({ id: "beta", version: "2.0.0", kind: "semantic" }, 2600), baselineEvidence: [], candidateEvidence: [] };
    const result = await runReview(context([{ id: "beta", version: "2.0.0", kind: "semantic" }]), new CheckerRegistry([
      new FakeChecker("beta", "2.0.0", "semantic", { findings: [invalid] }),
    ]), { clock: { now: () => new Date("2026-08-19T08:00:00.000Z") }, idFactory: new SequenceIdFactory(2700), mode: "sequential" });
    expect(result).toMatchObject({ ok: true, value: { status: "completed_with_checker_errors", findings: [{ kind: "checker_error" }] } });
  });

  it("distinguishes a healthy zero-finding run from checker failure", async () => {
    const clean = await runReview(context([{ id: "alpha", version: "1.0.0", kind: "deterministic" }]), new CheckerRegistry([
      new FakeChecker("alpha", "1.0.0", "deterministic", { findings: [] }),
    ]), { clock: { now: () => new Date("2026-08-19T08:00:00.000Z") }, idFactory: new SequenceIdFactory(2800), mode: "sequential" });
    expect(clean).toMatchObject({ ok: true, value: { status: "completed_no_findings", findings: [] } });
  });
});
