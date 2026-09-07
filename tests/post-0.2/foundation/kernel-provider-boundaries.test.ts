import { afterEach, expect, it } from "vitest";
import { decodeProviderAssessment } from "@sestina/core";
import {
  applicationFixture,
  ApplicationProvider,
  session,
  commit,
} from "../application-fixtures.js";
const fixtures: Awaited<ReturnType<typeof applicationFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.cleanup();
});
async function prepared(provider = new ApplicationProvider()) {
  const f = await applicationFixture(provider, { timeoutMs: 2000 });
  fixtures.push(f);
  const draft = f.kernel.createReview(
    'A quoted "phrase"\non a second line',
    session,
  );
  const p = await f.kernel.prepareManifest(
    draft.id,
    draft.version,
    {},
    true,
    session,
  );
  let r = await f.kernel.confirmManifest(
    draft.id,
    p.review.version,
    p.manifest.identityHash,
    session,
  );
  r = f.kernel.prepareAttempt(draft.id, r.version, session);
  return { f, p, r, provider };
}
it("G5 quote integrity compares the selected text, not JSON escape sequences or object keys", async () => {
  const { p } = await prepared();
  const request = JSON.parse(p.manifest.exactRequestBody!),
    binding = JSON.parse(request.messages[1].content).requestBinding;
  const body = (quote: string) =>
    JSON.stringify({
      schemaVersion: "2.0.0",
      requestBinding: binding,
      publicSummary: "Opinion only",
      quotedSpans: [{ quote }],
    });
  expect(
    decodeProviderAssessment(body('"phrase"\non a second line'), p.manifest)
      .envelope!.quoted_span_integrity_valid,
  ).toBe(true);
  expect(
    decodeProviderAssessment(body("contextProjectionHash"), p.manifest)
      .envelope!.quoted_span_integrity_valid,
  ).toBe(false);
  const malformed = JSON.stringify({
    schemaVersion: "2.0.0",
    requestBinding: binding,
    publicSummary: 42,
    quotedSpans: [],
  });
  expect(
    decodeProviderAssessment(malformed, p.manifest).envelope,
  ).toMatchObject({
    request_binding_valid: true,
    response_schema_valid: false,
    provider_assessment_available: false,
  });
});
it("G5 cancelling an adapter that ignores abort settles promptly and never records its late response", async () => {
  const provider = new ApplicationProvider();
  provider.send = (body) => {
    provider.calls.push(body);
    return new Promise(() => {});
  };
  const { f, p, r } = await prepared(provider);
  const pending = f.kernel.startAttempt(
    r.id,
    r.version,
    p.manifest.identityHash,
    session,
  );
  await new Promise((resolve) => setImmediate(resolve));
  f.kernel.cancelAttempt(
    r.id,
    f.kernel.readReview(r.id, session).review.version,
    session,
  );
  const settled = await Promise.race([
    pending.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  expect(settled).toBe(true);
  expect(f.kernel.readReview(r.id, session).attempts[0]!.status).toBe(
    "uncertain",
  );
});
it.each([
  "provider_http_error",
  "provider_response_too_large",
  "provider_invalid_response",
])(
  "G5 known %s is failed and still permits the user's effect",
  async (code) => {
    const provider = new ApplicationProvider();
    provider.send = async (body) => {
      provider.calls.push(body);
      throw Object.assign(new Error("Synthetic bounded failure"), { code });
    };
    const { f, p, r } = await prepared(provider);
    await f.kernel.startAttempt(
      r.id,
      r.version,
      p.manifest.identityHash,
      session,
    );
    const state = f.kernel.readReview(r.id, session);
    expect(state.attempts[0]!.status).toBe("failed");
    expect(state.attempts[0]!.failureCode).toBe(code);
    expect(
      commit(f, state.review, {
        kind: "record_only",
        outcome: "assessment_disputed",
        reason: "User declines the assessment",
      }).afterProjectStateRevision,
    ).toBe(state.projectStateRevision + 1);
  },
);
it("G5 a local skip after assessment binds the Receipt to the current no-send Manifest", async () => {
  const { f, p, r } = await prepared();
  await f.kernel.startAttempt(
    r.id,
    r.version,
    p.manifest.identityHash,
    session,
  );
  const assessed = f.kernel.readReview(r.id, session),
    local = await f.kernel.skipAssessment(
      r.id,
      assessed.review.version,
      session,
    );
  const receipt = commit(f, local, {
    kind: "record_only",
    outcome: "reference_only",
    reason: "User continues locally",
  });
  expect(receipt.assessmentAvailability).toBe("not_requested");
  expect(receipt.assessmentAttemptId).toBeNull();
  expect(f.kernel.readReview(r.id, session).attempts[0]).toEqual(
    assessed.attempts[0],
  );
});
it("G5 response persistence failure rolls back the assessment and reports uncertainty without retry", async () => {
  const provider = new ApplicationProvider(),
    f = await applicationFixture(provider, {
      workflowFaultInjection: () => {
        throw Error("Synthetic disk failure");
      },
    });
  fixtures.push(f);
  const a = f.kernel.createReview("Request", session),
    p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
  let r = await f.kernel.confirmManifest(
    a.id,
    p.review.version,
    p.manifest.identityHash,
    session,
  );
  r = f.kernel.prepareAttempt(a.id, r.version, session);
  await expect(
    f.kernel.startAttempt(a.id, r.version, p.manifest.identityHash, session),
  ).rejects.toThrow("commit_uncertain");
  await f.restart();
  const restored = f.kernel.readReview(a.id, session);
  expect(restored.review.status).toBe("provider_attempt_uncertain");
  expect(restored.attempts[0]!.assessment).toBeNull();
  expect(provider.calls).toHaveLength(1);
});
it("G5 correction appends a child and new draft without overwriting the assessment or terminal outcome", async () => {
  const { f, p, r } = await prepared();
  await f.kernel.startAttempt(
    r.id,
    r.version,
    p.manifest.identityHash,
    session,
  );
  const assessed = f.kernel.readReview(r.id, session),
    receipt = commit(f, assessed.review, {
      kind: "record_only",
      outcome: "assessment_disputed",
      reason: "Disagree",
    });
  const terminal = f.kernel.readReview(r.id, session),
    attempt = terminal.attempts[0]!;
  const child = f.kernel.appendCorrection(
    r.id,
    terminal.review.version,
    attempt.id,
    attempt.assessmentHash!,
    "Public correction",
    session,
  );
  expect(child.review.source).toEqual({ kind: "review", id: r.id });
  expect(child.review.status).toBe("draft");
  await f.restart();
  const restored = f.kernel.readReview(r.id, session);
  expect(restored.attempts[0]).toEqual(attempt);
  expect(restored.review).toEqual(terminal.review);
  expect(restored.corrections).toEqual([child.correction]);
  expect(restored.projectStateRevision).toBe(receipt.afterProjectStateRevision);
});
it("G5 structured opinions retain their provider identity and substantive label without becoming theoretical contributions", async () => {
  const provider = new ApplicationProvider(),
    original = provider.send.bind(provider);
  provider.send = async (body, signal) => {
    const response = JSON.parse(await original(body, signal));
    response.assessment = {
      findings: [
        {
          kind: "limitation",
          severity: "warning",
          publicRationale: "Insufficient support",
          minimalCorrection: "Retain uncertainty",
          unknowns: ["Causal direction"],
          sourceSpans: [],
          authorityClass: "model_proposed_assessment",
        },
      ],
      argumentDelta: {
        status: "substantive",
        summary: "Provider suggests a change",
        sourceSpans: [],
      },
    };
    return JSON.stringify(response);
  };
  const { f, p, r } = await prepared(provider);
  await f.kernel.startAttempt(
    r.id,
    r.version,
    p.manifest.identityHash,
    session,
  );
  await f.restart();
  const state = f.kernel.readReview(r.id, session),
    envelope = state.attempts[0]!.assessment!.envelope!;
  expect(envelope).toMatchObject({
    assessmentId: state.attempts[0]!.id,
    reviewId: r.id,
    manifestId: p.manifest.id,
    providerIdentity: provider.identity,
    authorityClass: "model_proposed_assessment",
    canMutateAuthority: false,
    assessment: { argumentDelta: { status: "substantive" } },
  });
  expect(JSON.stringify(envelope)).not.toContain("theoretical_contribution");
  expect(JSON.stringify(envelope)).not.toContain("0.66");
});
