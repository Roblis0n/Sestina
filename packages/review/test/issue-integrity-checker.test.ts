import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  createResearchIssue,
  resolveResearchIssue,
  waiveResearchIssue,
  type ResearchIssue,
} from "@sestina/research";
import {
  IssueIntegrityChecker,
  calculateReviewInputHash,
  createFinding,
  findingToIssueCandidate,
  parseReviewContext,
  type Finding,
  type ReviewContext,
} from "../src/index.js";

const ids = new SequenceIdFactory(6000);
const projectId = ids.create("rprj_"); const episodeId = ids.create("repi_"); const artifactId = ids.create("rart_");
const baselineId = ids.create("rrev_"); const candidateId = ids.create("rrev_"); const briefId = ids.create("rbrf_"); const snapshotId = ids.create("rsnp_");

function context(): ReviewContext {
  const input = {
    project: { id: projectId, version: 1 }, episode: { id: episodeId, version: 2, artifactId, baselineRevisionId: baselineId, candidateRevisionId: candidateId },
    baselineRevision: { id: baselineId, artifactId, projectId, contentHash: "a".repeat(64) }, candidateRevision: { id: candidateId, artifactId, projectId, parentRevisionId: baselineId, contentHash: "b".repeat(64) },
    briefVersion: { id: briefId, versionNumber: 1 }, activeDecisions: [], relevantIssues: [], evidenceBoundaries: [], snapshot: { id: snapshotId, projectId, episodeId, hash: "c".repeat(64) },
    checkerSet: [{ id: "scope", version: "1", kind: "deterministic" as const }], environmentFingerprint: "d".repeat(64), buildFingerprint: "e".repeat(64),
  };
  const parsed = parseReviewContext({ ...input, inputHash: calculateReviewInputHash(input) }); if (!parsed.ok) throw new Error(parsed.error.code); return parsed.value;
}

function rawFinding(seed = 6100, heading = "Introduction"): Finding {
  const ctx = context();
  const finding = createFinding({
    id: new SequenceIdFactory(seed).create("rfnd_"), kind: "scope_violation", severity: "error",
    target: { kind: "artifact", artifactId }, baselineEvidence: [],
    candidateEvidence: [{ artifactId, revisionId: candidateId, startLine: 2, endLine: 3, excerptHash: "f".repeat(64) }],
    briefVersionId: briefId, decisionIds: [], issueIds: [], checker: { id: "scope", version: "1", kind: "deterministic" }, confidence: { source: "rule", value: 1 },
    rationale: `Scope violation in ${heading}`, minimumRecovery: "Restore the bounded text", needsUserDecision: false, presentation: "foreground", provenance: { authority: "system_derived", inputHash: ctx.inputHash },
  });
  if (!finding.ok) throw new Error(finding.error.code); return finding.value;
}

function issueFor(finding: Finding): ResearchIssue {
  const candidate = findingToIssueCandidate(finding, context(), "2026-08-19T11:00:00.000Z");
  if (!candidate.ok) throw new Error(candidate.error.code);
  const issue = createResearchIssue(candidate.value.input, { clock: new FixedClock("2026-08-19T11:00:00.000Z"), idFactory: new SequenceIdFactory(6200) });
  if (!issue.ok) throw new Error(issue.error.code); return issue.value;
}

function resolved(issue: ResearchIssue): ResearchIssue {
  const result = resolveResearchIssue(issue, { kind: "system", component: "test" }, issue.version, "resolved", { resolutionEvidenceId: "evidence-1", briefVersionId: briefId, frozenDecisionIds: [] }, new FixedClock("2026-08-19T11:30:00.000Z"));
  if (!result.ok) throw new Error(result.error.code); return result.value;
}

describe("Finding to Issue suppression integration", () => {
  it("links same_open without creating a duplicate foreground issue", async () => {
    const raw = rawFinding(); const existing = issueFor(raw);
    const result = await new IssueIntegrityChecker({ findings: [raw], issueLookup: { ok: true, issues: [existing] }, recordedAt: "2026-08-19T12:00:00.000Z", reopenContext: {} }).run(context());
    expect(result.observations).toEqual([expect.objectContaining({ code: "same_open" })]);
    expect(result.findings[0]).toMatchObject({ presentation: "audit_only", issueIds: [existing.id] });
    expect(existing.status).toBe("open");
  });

  it("suppresses an unchanged resolved repeat but retains it in output", async () => {
    const raw = rawFinding(); const existing = resolved(issueFor(raw));
    const result = await new IssueIntegrityChecker({ findings: [raw], issueLookup: { ok: true, issues: [existing] }, recordedAt: "2026-08-19T12:00:00.000Z", reopenContext: { currentRevisionContentHash: existing.sourceRevisionContentHash } }).run(context());
    expect(result.observations?.[0]).toMatchObject({ code: "suppress" });
    expect(result.findings).toEqual([expect.objectContaining({ id: raw.id, presentation: "suppressed", issueIds: [existing.id] })]);
  });

  it("only suggests eligible_reopen and traces every changed input reason", async () => {
    const raw = rawFinding(); const existing = resolved(issueFor(raw));
    const result = await new IssueIntegrityChecker({ findings: [raw], issueLookup: { ok: true, issues: [existing] }, recordedAt: "2026-08-19T12:00:00.000Z", reopenContext: { currentRevisionContentHash: "1".repeat(64), currentBriefVersionId: ids.create("rbrf_"), evidenceBoundaryChanged: true, reviewInputChanged: true } }).run(context());
    expect(result.observations?.[0]).toMatchObject({ code: "eligible_reopen" });
    expect(result.observations?.[0]?.message).toMatch(/revision_content_changed.*brief_changed.*evidence_boundary_changed.*review_input_changed/);
    expect(result.findings[0]).toMatchObject({ presentation: "foreground", needsUserDecision: true, issueIds: [existing.id] });
    expect(existing.status).toBe("resolved");
  });

  it("keeps new and related-distinct findings in the foreground with a distinction", async () => {
    const original = rawFinding(); const existing = issueFor(original); const distinct = rawFinding(6300, "Discussion");
    const candidate = findingToIssueCandidate(distinct, context(), "2026-08-19T12:00:00.000Z");
    if (!candidate.ok) throw new Error(candidate.error.code);
    const override = { ...candidate.value.input, target: { kind: "heading" as const, artifactId, heading: "Discussion" } };
    const result = await new IssueIntegrityChecker({ findings: [distinct], issueLookup: { ok: true, issues: [existing] }, recordedAt: "2026-08-19T12:00:00.000Z", reopenContext: {}, candidateOverrides: new Map([[distinct.id, override]]) }).run(context());
    expect(result.observations?.[0]).toMatchObject({ code: "related_distinct" });
    expect(result.observations?.[0]?.message).toMatch(/different_target_scope/);
    expect(result.findings[0]?.presentation).toBe("foreground");
  });

  it("does not reopen a user-waived issue", async () => {
    const raw = rawFinding(); const issue = issueFor(raw);
    const waived = waiveResearchIssue(issue, { kind: "user", actorId: "lead" }, issue.version, "Known limitation", new FixedClock("2026-08-19T11:30:00.000Z"));
    if (!waived.ok) throw new Error(waived.error.code);
    const result = await new IssueIntegrityChecker({ findings: [raw], issueLookup: { ok: true, issues: [waived.value] }, recordedAt: "2026-08-19T12:00:00.000Z", reopenContext: { reviewInputChanged: true } }).run(context());
    expect(result.observations?.[0]).toMatchObject({ code: "related_distinct" });
    expect(waived.value.status).toBe("waived");
  });

  it("treats Issue lookup failure as unknown, never as no existing issue", async () => {
    const raw = rawFinding();
    const result = await new IssueIntegrityChecker({ findings: [raw], issueLookup: { ok: false }, recordedAt: "2026-08-19T12:00:00.000Z", reopenContext: {} }).run(context());
    expect(result.observations?.[0]).toMatchObject({ code: "unknown" });
    expect(result.findings[0]).toMatchObject({ presentation: "audit_only", needsUserDecision: true });
  });
});
