import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  acknowledgeResearchIssue,
  createResearchIssue,
  disputeResearchIssue,
  matchResearchIssue,
  reopenResearchIssue,
  resolveResearchIssue,
  suppressResolvedIssue,
  waiveResearchIssue,
  type ResearchIssueInput,
  type ResearchSource,
} from "../src/index.js";

const MODEL: ResearchSource = {
  actor: { kind: "model", model: "checker" },
  authority: "model_proposed",
  recordedAt: "2026-08-19T05:00:00.000Z",
};
const USER_ACTOR = { kind: "user", actorId: "lead" } as const;
const SYSTEM_ACTOR = { kind: "system", component: "issue-ledger" } as const;

function env() {
  return { clock: new FixedClock("2026-08-19T05:30:00.000Z"), idFactory: new SequenceIdFactory(1200) };
}

function baseInput(ids = new SequenceIdFactory(1300)): ResearchIssueInput {
  const artifactId = ids.create("rart_");
  return {
    projectId: ids.create("rprj_"),
    kind: "evidence_boundary",
    target: { kind: "heading", artifactId, heading: "Introduction" },
    violatedCriterion: "no-causal-claim-without-causal-evidence",
    rationaleConcepts: ["causal claim", "cross sectional data"],
    summary: "The introduction overstates a causal relationship",
    sourceArtifactId: artifactId,
    sourceRevisionId: ids.create("rrev_"),
    sourceRevisionContentHash: "1".repeat(64),
    lineageRootRevisionId: ids.create("rrev_"),
    source: MODEL,
  };
}

function resolvedIssue() {
  const environment = env();
  const created = createResearchIssue(baseInput(), environment);
  if (!created.ok) throw new Error(created.error.code);
  const acknowledged = acknowledgeResearchIssue(created.value, SYSTEM_ACTOR, created.value.version, "Acknowledged", environment.clock);
  if (!acknowledged.ok) throw new Error(acknowledged.error.code);
  const resolved = resolveResearchIssue(
    acknowledged.value,
    SYSTEM_ACTOR,
    acknowledged.value.version,
    "Bounded the statement",
    {
      resolutionEvidenceId: "evidence-1",
      briefVersionId: new SequenceIdFactory(1400).create("rbrf_"),
      frozenDecisionIds: [],
    },
    environment.clock,
  );
  if (!resolved.ok) throw new Error(resolved.error.code);
  return { environment, issue: resolved.value };
}

describe("Issue Ledger fingerprints and matching", () => {
  it("uses structured concepts so synonymous summaries match the same issue", () => {
    const environment = env();
    const input = baseInput();
    const created = createResearchIssue(input, environment);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const candidate = {
      ...input,
      summary: "Causal language is unsupported by the correlational design",
      rationaleConcepts: ["cross-sectional   data", "CAUSAL CLAIM"],
    };
    const match = matchResearchIssue(candidate, [created.value]);
    expect(match).toEqual({ ok: true, value: { kind: "same_open", issueId: created.value.id } });
  });

  it("does not merge the same issue kind and rationale across distinct headings", () => {
    const environment = env();
    const input = baseInput();
    const created = createResearchIssue(input, environment);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const candidate = { ...input, target: { ...input.target, heading: "Discussion" } } as ResearchIssueInput;
    const match = matchResearchIssue(candidate, [created.value]);
    expect(match.ok).toBe(true);
    if (match.ok) expect(match.value).toMatchObject({ kind: "related_but_distinct", issueId: created.value.id });
  });

  it("keeps text-unchanged resolved issues suppressed and allows content-change reopening", () => {
    const { issue } = resolvedIssue();
    const candidate = { ...baseInput(), projectId: issue.projectId, sourceArtifactId: issue.sourceArtifactId, lineageRootRevisionId: issue.lineageRootRevisionId, target: issue.target, violatedCriterion: issue.violatedCriterion, rationaleConcepts: issue.rationaleConcepts };
    const unchanged = matchResearchIssue(candidate, [issue], { currentRevisionContentHash: issue.sourceRevisionContentHash });
    expect(unchanged).toEqual({ ok: true, value: { kind: "suppressed_resolved", issueId: issue.id } });
    const changed = matchResearchIssue(candidate, [issue], { currentRevisionContentHash: "2".repeat(64) });
    expect(changed.ok).toBe(true);
    if (changed.ok) expect(changed.value).toMatchObject({ kind: "eligible_to_reopen", issueId: issue.id, reasons: ["revision_content_changed"] });
  });

  it("reopens only when an explicit condition is met and records full history", () => {
    const { environment, issue } = resolvedIssue();
    expect(reopenResearchIssue(issue, SYSTEM_ACTOR, issue.version, "retry", { currentRevisionContentHash: issue.sourceRevisionContentHash }, environment.clock)).toMatchObject({ ok: false, error: { code: "issue_reopen_not_allowed" } });
    const reopened = reopenResearchIssue(issue, SYSTEM_ACTOR, issue.version, "text changed", { currentRevisionContentHash: "2".repeat(64) }, environment.clock);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.value.status).toBe("reopened");
      expect(reopened.value.transitions.map((item) => item.to)).toEqual(["open", "acknowledged", "resolved", "reopened"]);
      expect(reopened.value.reopenHistory[0]?.reasons).toEqual(["revision_content_changed"]);
    }
  });

  it("suppresses a resolved issue without deleting its resolution history", () => {
    const { environment, issue } = resolvedIssue();
    const suppressed = suppressResolvedIssue(issue, SYSTEM_ACTOR, issue.version, "Do not repeat unchanged finding", environment.clock);
    expect(suppressed.ok).toBe(true);
    if (suppressed.ok) {
      expect(suppressed.value.status).toBe("suppressed");
      expect(suppressed.value.resolution).toEqual(issue.resolution);
    }
  });

  it("keeps waived separate from resolved and requires a user", () => {
    const environment = env();
    const created = createResearchIssue(baseInput(), environment);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(waiveResearchIssue(created.value, { kind: "model", model: "forger" }, created.value.version, "waive", environment.clock)).toMatchObject({ ok: false, error: { code: "user_issue_action_required" } });
    const waived = waiveResearchIssue(created.value, USER_ACTOR, created.value.version, "Known limitation", environment.clock);
    expect(waived.ok).toBe(true);
    if (!waived.ok) return;
    expect(waived.value.status).toBe("waived");
    expect(waived.value.resolution).toBeUndefined();
    const match = matchResearchIssue(baseInput(), [waived.value]);
    expect(match.ok).toBe(true);
    if (match.ok) expect(match.value).toMatchObject({ kind: "related_but_distinct", distinction: "waived_by_user" });
  });

  it("does not let a model force-close a disputed issue", () => {
    const environment = env();
    const created = createResearchIssue(baseInput(), environment);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const disputed = disputeResearchIssue(created.value, USER_ACTOR, created.value.version, "Criterion does not apply", environment.clock);
    expect(disputed.ok).toBe(true);
    if (!disputed.ok) return;
    expect(resolveResearchIssue(disputed.value, { kind: "model", model: "closer" }, disputed.value.version, "close", { resolutionEvidenceId: "evidence" }, environment.clock)).toMatchObject({ ok: false, error: { code: "invalid_issue_transition" } });
  });
});
