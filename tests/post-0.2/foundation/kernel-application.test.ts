import { it, expect, afterEach } from "vitest";
import { readKernelSnapshot } from "@sestina/research-store";
import {
  applicationFixture,
  ApplicationProvider,
  session,
  ready,
  commit,
} from "../application-fixtures.js";
const fixtures: Awaited<ReturnType<typeof applicationFixture>>[] = [];
async function setup(provider?: ApplicationProvider) {
  const f = await applicationFixture(provider);
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.cleanup();
});
const decision = {
  kind: "create_decision",
  mode: "create",
  statement: "Retain observational limits",
  rationale: "The supplied material does not establish causes.",
  scope: { kind: "project" },
  reopenConditions: ["New evidence"],
  reason: "Explicit user choice",
};
const evidence = {
  kind: "add_evidence",
  evidence: {
    kind: "literature_source",
    state: "current",
    summary: "Synthetic observation",
    inferenceCapacity: "descriptive",
    provenance: { citation: "Synthetic source A", locator: "page 1" },
  },
  links: [],
  reason: "Record source without proof promotion",
};
it.each(["rejected", "deferred", "reference_only", "assessment_disputed"])(
  "G4: record_only %s changes no objects and records one outcome",
  async (outcome) => {
    const f = await setup(),
      before = readKernelSnapshot(f.kernel.database, f.projectId),
      r = await ready(f);
    const receipt = commit(f, r, {
      kind: "record_only",
      outcome,
      reason: "User records outcome",
    });
    const after = readKernelSnapshot(f.kernel.database, f.projectId);
    expect(after.state.objects).toEqual(before.state.objects);
    expect(receipt.resultingObjects).toEqual([]);
    expect(after.head.revision).toBe(before.head.revision + 1);
    expect(
      f.kernel.readReview(r.id, session).review.terminalOutcome?.kind,
    ).toBe(outcome);
  },
);
it.each([undefined, "failure", "invalid", "timeout", "valid"] as const)(
  "G4/G5: assessment %s never vetoes a real user Decision",
  async (mode) => {
    const provider = mode ? new ApplicationProvider(mode) : undefined,
      f = await setup(provider);
    let r = f.kernel.createReview("Retain observational limits", session);
    if (provider) {
      const prepared = await f.kernel.prepareManifest(
        r.id,
        r.version,
        {},
        true,
        session,
      );
      r = await f.kernel.confirmManifest(
        r.id,
        prepared.review.version,
        prepared.manifest.identityHash,
        session,
      );
      r = f.kernel.prepareAttempt(r.id, r.version, session);
      await f.kernel.startAttempt(
        r.id,
        r.version,
        prepared.manifest.identityHash,
        session,
      );
      expect(provider.calls[0]).toBe(prepared.manifest.exactRequestBody);
      r = f.kernel.readReview(r.id, session).review;
    } else r = await f.kernel.skipAssessment(r.id, r.version, session);
    const receipt = commit(f, r, decision),
      object = readKernelSnapshot(
        f.kernel.database,
        f.projectId,
      ).state.objects.find((o) => o.id === receipt.resultingObjects[0]?.id)!;
    expect(object.data.statement).toBe(decision.statement);
    expect(object.data.status).toBe("accepted");
    expect(object.version).toBe(1);
    expect(f.kernel.readReview(r.id, session).review.status).toBe("committed");
  },
);
it("G4: Evidence keeps provenance without conferring proof, and a duplicate is refused", async () => {
  const f = await setup(),
    r = await ready(f),
    receipt = commit(f, r, evidence);
  const object = readKernelSnapshot(
    f.kernel.database,
    f.projectId,
  ).state.objects.find((o) => o.id === receipt.resultingObjects[0]?.id)!;
  expect(object.data.provenance).toEqual(evidence.evidence.provenance);
  expect(object.data.inferenceCapacity).toBe("descriptive");
  expect(object.data).not.toHaveProperty("supportStatus", "proven");
  const second = await ready(f);
  expect(() =>
    f.kernel.prepareEffect(second.id, second.version, evidence, session),
  ).toThrow("idempotency_conflict");
});
it.each(["patch_brief", "formal_direction_change"] as const)(
  "G4: %s saves a superseding version with the prior question intact",
  async (kind) => {
    const f = await setup(),
      r = await ready(f),
      before = readKernelSnapshot(
        f.kernel.database,
        f.projectId,
      ).state.objects.find((o) => o.kind === "brief")!;
    const payload = {
      kind,
      targetId: before.id,
      expectedVersion: before.version,
      baseVersionId: before.data.currentVersionId,
      reason: "User changes the bounded plan",
      ...(kind === "patch_brief"
        ? { changes: { currentTask: "Inspect the new limitation" } }
        : {
            newQuestion: "Which observation needs investigation?",
            impactSummary: "Pending context requires confirmation again",
          }),
    };
    const receipt = commit(f, r, payload),
      after = readKernelSnapshot(
        f.kernel.database,
        f.projectId,
      ).state.objects.find((o) => o.id === before.id)!;
    const oldVersions = before.data.versions as unknown[],
      versions = after.data.versions as Record<string, unknown>[];
    expect(versions.slice(0, -1)).toEqual(oldVersions);
    expect(versions.at(-1)?.supersedes).toBe(before.data.currentVersionId);
    expect(after.version).toBe(before.version + 1);
    expect(receipt.resultingObjects[0]?.id).toBe(before.id);
    await f.restart();
    expect(f.kernel.readReview(r.id, session).review.status).toBe("committed");
  },
);
it("G4: caller actor labels and serialized capabilities cannot authorize a commit", async () => {
  const f = await setup(),
    r = await ready(f),
    p = f.kernel.prepareEffect(r.id, r.version, decision, session),
    d = p.effectDraft!;
  for (const cap of [
    { kind: "user", actorId: "synthetic-owner" },
    { ...session },
    { kind: "provider" },
    null,
  ])
    expect(() =>
      f.kernel.commitEffect(
        p.id,
        p.version,
        d.previewHash,
        d.authorityCommandId!,
        cap,
      ),
    ).toThrow("authority_required");
  expect(readKernelSnapshot(f.kernel.database, f.projectId).head.revision).toBe(
    1,
  );
});
it("G4/G5: a saved preview survives restart, commits exactly once, and is found by command identity", async () => {
  const f = await setup(),
    r = await ready(f),
    p = f.kernel.prepareEffect(r.id, r.version, decision, session),
    d = p.effectDraft!;
  await f.restart();
  expect(f.kernel.readReview(r.id, session).review.effectDraft).toEqual(d);
  const first = f.kernel.commitEffect(
    p.id,
    p.version,
    d.previewHash,
    d.authorityCommandId!,
    session,
  );
  const replay = f.kernel.commitEffect(
    p.id,
    p.version,
    d.previewHash,
    d.authorityCommandId!,
    session,
  );
  expect(replay).toEqual(first);
  expect(f.kernel.lookupCommand(d.authorityCommandId!, session)).toEqual(first);
  expect(readKernelSnapshot(f.kernel.database, f.projectId).head.revision).toBe(
    2,
  );
});
it("G4: a changed payload invalidates the old approval and keeps the effect identity", async () => {
  const f = await setup(),
    r = await ready(f),
    p = f.kernel.prepareEffect(r.id, r.version, decision, session);
  const edited = f.kernel.prepareEffect(
    r.id,
    p.version,
    { ...decision, statement: "Different user decision" },
    session,
  );
  expect(edited.effectDraft?.effectId).toBe(p.effectDraft?.effectId);
  expect(edited.effectDraft?.previewHash).not.toBe(p.effectDraft?.previewHash);
  expect(() =>
    f.kernel.commitEffect(
      r.id,
      p.version,
      p.effectDraft!.previewHash,
      p.effectDraft!.authorityCommandId!,
      session,
    ),
  ).toThrow();
});
it("G5: B's outcome invalidates A's confirmed request before any send", async () => {
  const provider = new ApplicationProvider(),
    f = await setup(provider),
    a = f.kernel.createReview("A request", session);
  const p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
  let ar = await f.kernel.confirmManifest(
    a.id,
    p.review.version,
    p.manifest.identityHash,
    session,
  );
  ar = f.kernel.prepareAttempt(a.id, ar.version, session);
  commit(f, await ready(f), {
    kind: "record_only",
    outcome: "deferred",
    reason: "B changes review history",
  });
  await expect(
    f.kernel.startAttempt(a.id, ar.version, p.manifest.identityHash, session),
  ).rejects.toThrow("stale_revision");
  expect(provider.calls).toHaveLength(0);
  expect(f.kernel.readReview(a.id, session).review.status).toBe("stale");
});
it("G5: configuration generation changes block all network calls", async () => {
  const provider = new ApplicationProvider(),
    f = await setup(provider),
    a = f.kernel.createReview("A request", session);
  const p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
  let r = await f.kernel.confirmManifest(
    a.id,
    p.review.version,
    p.manifest.identityHash,
    session,
  );
  r = f.kernel.prepareAttempt(r.id, r.version, session);
  f.setProvider({
    ...provider,
    identity: { ...provider.identity, configGeneration: 2 },
    send: provider.send.bind(provider),
  });
  await expect(
    f.kernel.startAttempt(r.id, r.version, p.manifest.identityHash, session),
  ).rejects.toThrow("stale_revision");
  expect(provider.calls).toHaveLength(0);
});
it("G5: protocol-valid opinion does not acquire semantic correctness", async () => {
  const provider = new ApplicationProvider("unbound"),
    f = await setup(provider),
    a = f.kernel.createReview("A request", session);
  const p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
  let r = await f.kernel.confirmManifest(
    a.id,
    p.review.version,
    p.manifest.identityHash,
    session,
  );
  r = f.kernel.prepareAttempt(r.id, r.version, session);
  await f.kernel.startAttempt(
    r.id,
    r.version,
    p.manifest.identityHash,
    session,
  );
  const assessment = f.kernel.readReview(r.id, session).attempts[0]!
    .assessment!;
  expect(assessment.semanticCorrectness).toBe("unproven");
  expect(assessment.envelope).toEqual({
    schemaVersion: "2.0.0",
    request_binding_valid: false,
    response_schema_valid: true,
    quoted_span_integrity_valid: true,
    provider_assessment_available: true,
    assessmentId: r.attemptIds[0],
    reviewId: r.id,
    manifestId: p.manifest.id,
    providerIdentity: provider.identity,
    receivedAt: expect.any(String),
    authorityClass: "model_proposed_assessment",
    canMutateAuthority: false,
  });
});
