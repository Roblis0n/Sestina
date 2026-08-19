import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  activateRevisionEpisode,
  applyEpisodeWaiver,
  createResearchSnapshot,
  createRevisionEpisode,
  disposeRevisionEpisode,
  parseRevisionEpisode,
  rebuildEpisodeFromSnapshot,
  recordEpisodeReview,
  requireEpisodeUserAction,
  submitEpisodeCandidate,
  verifyResearchSnapshotHash,
  type CreateRevisionEpisodeInput,
  type ResearchActor,
  type ResearchSource,
  type RevisionEpisode,
} from "../src/index.js";

const MODEL_ACTOR: ResearchActor = { kind: "model", model: "writer" };
const SYSTEM_ACTOR: ResearchActor = { kind: "system", component: "episode-runtime" };
const USER_ACTOR: ResearchActor = { kind: "user", actorId: "lead" };
const USER_SOURCE: ResearchSource = {
  actor: USER_ACTOR,
  authority: "user_recorded",
  recordedAt: "2026-08-19T06:00:00.000Z",
};

function env(seed = 1600) {
  return { clock: new FixedClock("2026-08-19T06:30:00.000Z"), idFactory: new SequenceIdFactory(seed) };
}

function episodeInput(ids = new SequenceIdFactory(1700)): CreateRevisionEpisodeInput {
  return {
    projectId: ids.create("rprj_"),
    artifactId: ids.create("rart_"),
    source: USER_SOURCE,
    lockedStart: {
      briefVersionId: ids.create("rbrf_"),
      baselineRevisionId: ids.create("rrev_"),
      activeDecisions: [
        { decisionId: ids.create("rdec_"), status: "frozen", version: 2 },
      ],
      relevantIssues: [{ issueId: ids.create("riss_"), status: "resolved", version: 3 }],
      evidenceBoundaryIds: [ids.create("rbrf_")],
      checkerVersion: "checker-1.2.0",
      projectStateFingerprint: "a".repeat(64),
      repositoryStateFingerprint: "b".repeat(64),
    },
  };
}

function toUserActionRequired(): { episode: RevisionEpisode; environment: ReturnType<typeof env>; candidateId: string } {
  const environment = env();
  const created = createRevisionEpisode(episodeInput(), environment);
  if (!created.ok) throw new Error(created.error.code);
  const active = activateRevisionEpisode(created.value, SYSTEM_ACTOR, created.value.version, environment.clock);
  if (!active.ok) throw new Error(active.error.code);
  const candidateId = environment.idFactory.create("rrev_");
  const submitted = submitEpisodeCandidate(active.value, candidateId, MODEL_ACTOR, active.value.version, environment.clock);
  if (!submitted.ok) throw new Error(submitted.error.code);
  const reviewed = recordEpisodeReview(
    submitted.value,
    environment.idFactory.create("rrun_"),
    [environment.idFactory.create("rfnd_")],
    SYSTEM_ACTOR,
    submitted.value.version,
    environment.clock,
  );
  if (!reviewed.ok) throw new Error(reviewed.error.code);
  const required = requireEpisodeUserAction(
    reviewed.value,
    {
      fulfillment: "met",
      evidence: "proven",
      scope: "compliant",
      decisionIntegrity: "preserved",
      issueIntegrity: "preserved",
      userDisposition: "pending",
    },
    SYSTEM_ACTOR,
    reviewed.value.version,
    environment.clock,
  );
  if (!required.ok) throw new Error(required.error.code);
  return { episode: required.value, environment, candidateId };
}

describe("RevisionEpisode locked start and lifecycle", () => {
  it("locks independent copies of brief, baseline, decisions, issues, boundaries and state fingerprint", () => {
    const environment = env();
    const input = episodeInput();
    const result = createRevisionEpisode(input, environment);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("draft");
    expect(Object.isFrozen(result.value.lockedStart)).toBe(true);
    expect(Object.isFrozen(result.value.lockedStart.relevantIssues)).toBe(true);
    expect(result.value.lockedStart.activeDecisions[0]?.version).toBe(2);
    expect(result.value.lockedStart.baselineRevisionId).toBe(input.lockedStart.baselineRevisionId);
  });

  it("cannot replace the baseline after candidate submission", () => {
    const { episode, candidateId } = toUserActionRequired();
    expect(episode.candidateRevisionId).toBe(candidateId);
    const forged = {
      ...episode,
      lockedStart: { ...episode.lockedStart, baselineRevisionId: new SequenceIdFactory(1800).create("rrev_") },
    };
    expect(parseRevisionEpisode(forged)).toMatchObject({ ok: false, error: { code: "episode_lock_mismatch" } });
  });

  it("rejects stale Brief acceptance and allows only a user actor to accept", () => {
    const { episode, environment } = toUserActionRequired();
    expect(
      disposeRevisionEpisode(
        episode,
        "accepted",
        MODEL_ACTOR,
        episode.version,
        episode.lockedStart.briefVersionId,
        "forged acceptance",
        environment.clock,
      ),
    ).toMatchObject({ ok: false, error: { code: "user_episode_action_required" } });
    expect(
      disposeRevisionEpisode(
        episode,
        "accepted",
        USER_ACTOR,
        episode.version,
        environment.idFactory.create("rbrf_"),
        "stale",
        environment.clock,
      ),
    ).toMatchObject({ ok: false, error: { code: "stale_episode_brief" } });
  });

  it("records a waiver only for an explicit outcome dimension and scope", () => {
    const { episode, environment } = toUserActionRequired();
    expect(
      applyEpisodeWaiver(
        episode,
        { dimension: "scope", scope: { kind: "artifact", artifactId: episode.artifactId }, reason: "User accepts this bounded exception" },
        MODEL_ACTOR,
        episode.version,
        environment.clock,
      ),
    ).toMatchObject({ ok: false, error: { code: "user_episode_action_required" } });
    const waived = applyEpisodeWaiver(
      episode,
      { dimension: "scope", scope: { kind: "artifact", artifactId: episode.artifactId }, reason: "User accepts this bounded exception" },
      USER_ACTOR,
      episode.version,
      environment.clock,
    );
    expect(waived.ok).toBe(true);
    if (waived.ok) {
      expect(waived.value.waivers).toHaveLength(1);
      expect(waived.value.waivers[0]).toMatchObject({ dimension: "scope" });
      expect(waived.value.outcome?.userDisposition).toBe("waived");
    }
  });

  it("retains the complete history of a rejected episode", () => {
    const { episode, environment } = toUserActionRequired();
    const rejected = disposeRevisionEpisode(
      episode,
      "rejected",
      USER_ACTOR,
      episode.version,
      episode.lockedStart.briefVersionId,
      "Candidate weakens the argument",
      environment.clock,
    );
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.value.status).toBe("rejected");
      expect(rejected.value.candidateRevisionId).toBeDefined();
      expect(rejected.value.reviewRunIds).toHaveLength(1);
      expect(rejected.value.transitions.map((item) => item.to)).toEqual([
        "draft", "active", "candidate_submitted", "reviewed", "user_action_required", "rejected",
      ]);
    }
  });
});

describe("ResearchSnapshot", () => {
  it("serializes, verifies a canonical hash, and rebuilds a terminal episode", () => {
    const { episode, environment } = toUserActionRequired();
    const accepted = disposeRevisionEpisode(
      episode,
      "accepted",
      USER_ACTOR,
      episode.version,
      episode.lockedStart.briefVersionId,
      "Accepted after review",
      environment.clock,
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const snapshot = createResearchSnapshot(
      accepted.value,
      { buildVersion: "sestina-research-0.1.0", limitations: ["Hash proves integrity, not research correctness"] },
      environment,
    );
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyResearchSnapshotHash(snapshot.value)).toEqual({ ok: true, value: true });
    const rebuilt = rebuildEpisodeFromSnapshot(snapshot.value);
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) expect(rebuilt.value).toEqual(accepted.value);
  });

  it("detects snapshot tampering without treating hash validity as semantic proof", () => {
    const { episode, environment } = toUserActionRequired();
    const abandoned = disposeRevisionEpisode(
      episode,
      "abandoned",
      USER_ACTOR,
      episode.version,
      episode.lockedStart.briefVersionId,
      "Stop this revision",
      environment.clock,
    );
    expect(abandoned.ok).toBe(true);
    if (!abandoned.ok) return;
    const snapshot = createResearchSnapshot(abandoned.value, { buildVersion: "build-1", limitations: ["No semantic correctness proof"] }, environment);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const tampered = { ...snapshot.value, limitations: ["tampered"] };
    expect(verifyResearchSnapshotHash(tampered)).toEqual({ ok: true, value: false });
    expect(snapshot.value.hashMeaning).toBe("content_integrity_only");
  });
});
