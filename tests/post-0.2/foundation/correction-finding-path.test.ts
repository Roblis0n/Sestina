import { expect, it } from "vitest";
import { applicationFixture, ApplicationProvider, session, commit } from "../application-fixtures.js";

it("P2-01 G7: resolving an interpretation challenge must lead to the unified Review effect path", async () => {
  const provider = new ApplicationProvider();
  const originalSend = provider.send.bind(provider);
  provider.send = async (body, signal) => {
    const response = JSON.parse(await originalSend(body, signal)) as Record<string, unknown>;
    return JSON.stringify({ ...response,
      assessment: { findings: [{ kind: "argument_leap", severity: "warning", publicRationale: "A conditional statement was read as proof", minimalCorrection: "Retain the condition", unknowns: ["Whether the condition holds"], sourceSpans: [], authorityClass: "model_proposed_assessment" }], argumentDelta: { status: "unknown", summary: "No substantive result established", sourceSpans: [] } },
    });
  };
  const f = await applicationFixture(provider);
  try {
    const draft = f.kernel.createReview("Synthetic conditional statement", session);
    const prepared = await f.kernel.prepareManifest(draft.id, draft.version, {}, true, session);
    const confirmed = await f.kernel.confirmManifest(draft.id, prepared.review.version, prepared.manifest.identityHash, session);
    const attemptReady = f.kernel.prepareAttempt(draft.id, confirmed.version, session);
    await f.kernel.startAttempt(draft.id, attemptReady.version, prepared.manifest.identityHash, session);
    const original = f.kernel.readReview(draft.id, session);
    const attempt = original.attempts[0];
    if (!attempt?.assessmentHash) throw new Error("Original assessment missing");
    const finding = attempt.assessment?.envelope?.assessment?.findings[0];
    expect(finding?.kind).toBe("argument_leap");
    const corrected = f.kernel.appendCorrection(draft.id, original.review.version, attempt.id, attempt.assessmentHash, "The statement is conditional", session, { requestedCorrection: "qualify", findingIndex: 0 });
    expect(corrected.correction.continuationReviewId).toBe(corrected.review.id);
    expect(f.kernel.readReview(draft.id, session).attempts[0]?.assessment?.envelope?.assessment?.findings[0]).toEqual(finding);
    await f.restart();
    const ready = await f.kernel.skipAssessment(corrected.review.id, corrected.review.version, session);
    const result = commit(f, ready, { kind: "record_only", outcome: "assessment_disputed", reason: "Keep the original object and record the qualified interpretation" });
    expect(result.reviewId).toBe(corrected.review.id);
    expect(result.afterProjectStateRevision).toBe(2);
    expect(f.kernel.correctionHistory(draft.id, session)[0]).toMatchObject({ status: "closed", correction: { findingIndex: 0, continuationReviewId: corrected.review.id } });
    expect(f.kernel.readReview(draft.id, session).attempts[0]?.assessment?.envelope?.assessment?.findings[0]).toEqual(finding);
    expect(provider.calls).toHaveLength(1);
  } finally { await f.cleanup(); }
});
