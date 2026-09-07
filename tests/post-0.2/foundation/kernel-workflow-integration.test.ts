import { afterEach, it, expect } from "vitest";
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
const choice = {
  kind: "create_decision",
  mode: "create",
  statement: "Preserve uncertainty",
  rationale: "The record is observational",
  scope: { kind: "project" },
  reopenConditions: [],
  reason: "User choice",
};
const sourceEvidence = {
  kind: "add_evidence",
  evidence: {
    kind: "literature_source",
    summary: "Bounded synthetic source",
    state: "current",
    inferenceCapacity: "descriptive",
    provenance: { citation: "Synthetic source" },
  },
  links: [],
  reason: "Record source",
};
it("G4: create and resolve an Issue against canonical Evidence; repeat resolution creates no second result", async () => {
  const f = await setup();
  const created = commit(f, await ready(f), {
    kind: "create_or_resolve_issue",
    mode: "create",
    reason: "Investigate limitation",
    issue: {
      kind: "evidence_boundary",
      summary: "The inference needs support",
      target: { kind: "artifact", artifactId: f.artifact.artifact.id },
      violatedCriterion: "Observations do not establish causation",
      rationaleConcepts: ["inference"],
      sourceArtifactId: f.artifact.artifact.id,
      sourceRevisionId: f.artifact.revision.id,
      lineageRootRevisionId: f.artifact.revision.id,
      sourceRevisionContentHash: f.artifact.revision.content.contentHash,
    },
  });
  const ev = commit(f, await ready(f), sourceEvidence),
    issueId = created.resultingObjects.find((o) => o.kind === "issue")!.id;
  const payload = {
    kind: "create_or_resolve_issue",
    mode: "resolve",
    targetId: issueId,
    expectedVersion: 1,
    resolutionEvidenceId: ev.resultingObjects[0]!.id,
    reason: "The user records the bounded resolution",
  };
  commit(f, await ready(f), payload);
  const after = readKernelSnapshot(f.kernel.database, f.projectId),
    issue = after.state.objects.find((o) => o.id === issueId)!;
  expect(issue.data.status).toBe("resolved");
  expect(issue.version).toBe(2);
  const r = await ready(f);
  expect(() =>
    f.kernel.prepareEffect(
      r.id,
      r.version,
      { ...payload, expectedVersion: 2 },
      session,
    ),
  ).toThrow("already_resolved");
  expect(readKernelSnapshot(f.kernel.database, f.projectId).head).toEqual(
    after.head,
  );
});
it("G4: formal direction change atomically marks the previewed pending work stale", async () => {
  const f = await setup(),
    a = await ready(f, "Pending work A"),
    b = f.kernel.createReview("Pending work B", session),
    r = await ready(f, "Direction change");
  const brief = readKernelSnapshot(
    f.kernel.database,
    f.projectId,
  ).state.objects.find((o) => o.kind === "brief")!;
  const p = f.kernel.prepareEffect(
    r.id,
    r.version,
    {
      kind: "formal_direction_change",
      targetId: brief.id,
      expectedVersion: brief.version,
      baseVersionId: brief.data.currentVersionId,
      newQuestion: "What needs a different investigation?",
      impactSummary: "Reconfirm all pending work",
      reason: "User redirects",
    },
    session,
  );
  expect(JSON.stringify(p.effectDraft!.preview)).toContain(a.id);
  expect(JSON.stringify(p.effectDraft!.preview)).toContain(b.id);
  f.kernel.commitEffect(
    p.id,
    p.version,
    p.effectDraft!.previewHash,
    p.effectDraft!.authorityCommandId!,
    session,
  );
  expect(f.kernel.readReview(a.id, session).review.status).toBe("stale");
  expect(f.kernel.readReview(b.id, session).review.status).toBe("stale");
  expect(f.kernel.inspectManifest(a.id, session)?.status).toBe("stale");
});
it("G4/G5: a competing commit preserves the stale payload through an explicitly rebuilt preview", async () => {
  const f = await setup(),
    a = await ready(f),
    p = f.kernel.prepareEffect(a.id, a.version, choice, session);
  commit(f, await ready(f, "B"), {
    kind: "record_only",
    outcome: "deferred",
    reason: "B outcome",
  });
  expect(() =>
    f.kernel.commitEffect(
      p.id,
      p.version,
      p.effectDraft!.previewHash,
      p.effectDraft!.authorityCommandId!,
      session,
    ),
  ).toThrow("stale_revision");
  const stale = f.kernel.readReview(a.id, session).review;
  expect(stale.status).toBe("stale");
  expect(stale.effectDraft?.payload).toEqual(choice);
  const fresh = await f.kernel.skipAssessment(a.id, stale.version, session);
  expect(fresh.effectDraft?.payload).toEqual(choice);
  const next = f.kernel.prepareEffect(a.id, fresh.version, choice, session);
  expect(next.effectDraft?.effectId).toBe(p.effectDraft?.effectId);
  expect(next.effectDraft?.previewHash).not.toBe(p.effectDraft?.previewHash);
  expect(
    f.kernel.commitEffect(
      next.id,
      next.version,
      next.effectDraft!.previewHash,
      next.effectDraft!.authorityCommandId!,
      session,
    ).afterProjectStateRevision,
  ).toBe(3);
});
it.each(["failure", "timeout"] as const)(
  "G5: %s requires a new Manifest and ordinal for explicit retry",
  async (mode) => {
    const provider = new ApplicationProvider(mode),
      f = await setup(provider),
      a = f.kernel.createReview("Request", session);
    const p = await f.kernel.prepareManifest(
      a.id,
      a.version,
      {},
      true,
      session,
    );
    let r = await f.kernel.confirmManifest(
      a.id,
      p.review.version,
      p.manifest.identityHash,
      session,
    );
    r = f.kernel.prepareAttempt(a.id, r.version, session);
    await f.kernel.startAttempt(
      a.id,
      r.version,
      p.manifest.identityHash,
      session,
    );
    await f.restart();
    expect(provider.calls).toHaveLength(1);
    r = f.kernel.readReview(a.id, session).review;
    const original = f.kernel.readReview(a.id, session).attempts[0];
    expect(() => f.kernel.prepareAttempt(a.id, r.version, session)).toThrow();
    const rebuilt = await f.kernel.prepareManifest(
      a.id,
      r.version,
      {},
      true,
      session,
    );
    expect(rebuilt.manifest.id).not.toBe(p.manifest.id);
    expect(provider.calls).toHaveLength(1);
    r = await f.kernel.confirmManifest(
      a.id,
      rebuilt.review.version,
      rebuilt.manifest.identityHash,
      session,
    );
    r = f.kernel.prepareAttempt(a.id, r.version, session);
    expect(
      f.kernel.readReview(a.id, session).attempts.map((x) => x.ordinal),
    ).toEqual([1, 2]);
    expect(f.kernel.readReview(a.id, session).attempts[0]).toEqual(original);
    await f.kernel.startAttempt(
      a.id,
      r.version,
      rebuilt.manifest.identityHash,
      session,
    );
    expect(provider.calls).toHaveLength(2);
  },
);
it("G5: cancellation preserves uncertainty; a late response cannot replace a committed outcome", async () => {
  const provider = new ApplicationProvider();
  let finish!: (body: string) => void;
  provider.send = (body) => {
    provider.calls.push(body);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const f = await applicationFixture(provider, { timeoutMs: 2000 });
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
  const running = f.kernel.startAttempt(
    a.id,
    r.version,
    p.manifest.identityHash,
    session,
  );
  await new Promise((resolve) => setImmediate(resolve));
  r = f.kernel.readReview(a.id, session).review;
  f.kernel.cancelAttempt(a.id, r.version, session);
  r = f.kernel.readReview(a.id, session).review;
  expect(r.status).toBe("provider_attempt_uncertain");
  const receipt = commit(f, r, choice);
  finish("{}");
  await running;
  expect(
    f.kernel.readReview(a.id, session).review.terminalOutcome?.receiptId,
  ).toBe(receipt.id);
  expect(f.kernel.readReview(a.id, session).attempts[0]?.status).toBe(
    "uncertain",
  );
});
it("G4: a lost commit response is resolved through the durable command, without duplicate creation", async () => {
  let fail = true;
  const f = await applicationFixture(undefined, {
    faultInjection: (point) => {
      if (point === "after_commit" && fail) {
        fail = false;
        throw new Error("Synthetic response lost");
      }
    },
  });
  fixtures.push(f);
  const r = await ready(f),
    p = f.kernel.prepareEffect(r.id, r.version, choice, session),
    d = p.effectDraft!;
  expect(() =>
    f.kernel.commitEffect(
      p.id,
      p.version,
      d.previewHash,
      d.authorityCommandId!,
      session,
    ),
  ).toThrow("commit_uncertain");
  const found = f.kernel.lookupCommand(d.authorityCommandId!, session)!;
  expect(found.resultingObjects).toHaveLength(1);
  expect(
    f.kernel.commitEffect(
      p.id,
      p.version,
      d.previewHash,
      d.authorityCommandId!,
      session,
    ),
  ).toEqual(found);
});
it("G4/G5 direction commit interrupts a pending evaluation without accepting its late result", async () => {
  const provider = new ApplicationProvider();
  let finish!: (s: string) => void;
  provider.send = (body) => {
    provider.calls.push(body);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const f = await applicationFixture(provider, { timeoutMs: 2000 });
  fixtures.push(f);
  const a = f.kernel.createReview("Pending assessment", session),
    p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
  let r = await f.kernel.confirmManifest(
    a.id,
    p.review.version,
    p.manifest.identityHash,
    session,
  );
  r = f.kernel.prepareAttempt(a.id, r.version, session);
  const sending = f.kernel.startAttempt(
    a.id,
    r.version,
    p.manifest.identityHash,
    session,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const brief = readKernelSnapshot(
    f.kernel.database,
    f.projectId,
  ).state.objects.find((o) => o.kind === "brief")!;
  commit(f, await ready(f), {
    kind: "formal_direction_change",
    targetId: brief.id,
    expectedVersion: brief.version,
    baseVersionId: brief.data.currentVersionId,
    newQuestion: "New research direction?",
    impactSummary: "Invalidate pending assessment",
    reason: "User redirects",
  });
  finish("{}");
  await sending;
  const saved = f.kernel.readReview(a.id, session);
  expect(saved.review.status).toBe("stale");
  expect(saved.attempts[0]!.status).toBe("uncertain");
  expect(saved.attempts[0]!.assessment).toBeNull();
});
