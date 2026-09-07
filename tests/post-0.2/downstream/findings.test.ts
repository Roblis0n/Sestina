import { afterEach, describe, expect, it } from "vitest";
import { readKernelSnapshot } from "@sestina/research-store";
import { KernelApplicationApi } from "../../../apps/research-room/src/kernel-api.js";
import { applicationFixture, ApplicationProvider, session, ready, commit } from "../application-fixtures.js";
const states: Awaited<ReturnType<typeof applicationFixture>>[] = [];
async function fixture(provider?: ApplicationProvider) { const f = await applicationFixture(provider); states.push(f); return f; }
async function assess(f: Awaited<ReturnType<typeof applicationFixture>>) {
  const draft = f.kernel.createReview("Synthetic optional assessment", session);
  const p = await f.kernel.prepareManifest(draft.id, draft.version, {}, true, session);
  let r = await f.kernel.confirmManifest(draft.id, p.review.version, p.manifest.identityHash, session);
  r = f.kernel.prepareAttempt(r.id, r.version, session); await f.kernel.startAttempt(r.id, r.version, p.manifest.identityHash, session);
  return f.kernel.readReview(r.id, session);
}
afterEach(async () => { for (const s of states.splice(0)) await s.cleanup(); });
describe("accepted target / G4-G5 closed through persistent application entry", () => {
  it.each(["accepted", "modified_accepted"] as const)("P0-01 G4: generic %s cannot substitute a receipt for a typed object effect", async (disposition) => {
    const f = await fixture(); f.kernel.close(); const api = new KernelApplicationApi({});
    try { await api.open({ projectPath: f.root });
      await expect(api.execute({ projectId: f.projectId, action: "commit", disposition, actor: { kind: "user" }, modifiedProposal: "Bound the synthetic claim" }), "Generic acceptance has no typed target; it must fail instead of recording an apparent research result.").rejects.toThrow("invalid_record");
    } finally { api.close(); }
  });
  it.each([undefined, "failure", "invalid"] as const)("P1-01/P1-03 G4: unavailable assessment (%s) cannot veto a user decision", async (mode) => {
    const f = await fixture(mode === undefined ? undefined : new ApplicationProvider(mode));
    const r = mode === undefined ? await ready(f) : (await assess(f)).review;
    const brief = readKernelSnapshot(f.kernel.database, f.projectId).state.objects.find((o) => o.kind === "brief")!;
    const receipt = commit(f, r, { kind: "formal_direction_change", targetId: brief.id, expectedVersion: brief.version, baseVersionId: brief.data.currentVersionId, newQuestion: "Which synthetic limitation needs investigation?", impactSummary: "Pending context changes", reason: "User changes direction independently of an assessment" });
    expect(receipt.resultingObjects.some((o) => o.id === brief.id), "A valid user direction change is blocked only because the Provider is unavailable.").toBe(true);
    expect(JSON.stringify(readKernelSnapshot(f.kernel.database, f.projectId).state)).toContain("Which synthetic limitation needs investigation?");
  });
  it("P0-01 G5: B record-only invalidates A's earlier outbound confirmation", async () => {
    const provider = new ApplicationProvider(), f = await fixture(provider), a = f.kernel.createReview("A", session);
    const p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
    let r = await f.kernel.confirmManifest(a.id, p.review.version, p.manifest.identityHash, session); r = f.kernel.prepareAttempt(a.id, r.version, session);
    commit(f, await ready(f), { kind: "record_only", outcome: "deferred", reason: "Record B" }); const calls = provider.calls.length;
    await expect(f.kernel.startAttempt(a.id, r.version, p.manifest.identityHash, session)).rejects.toThrow("stale_revision");
    expect({ accepted: f.kernel.readReview(a.id, session).review.status !== "stale", additionalSends: provider.calls.length - calls }, "Review history changed the snapshot; old consent must permit zero sends.").toEqual({ accepted: false, additionalSends: 0 });
  });
  it("P1-02 G5: valid protocol plus unrelated rationale is not semantic readiness", async () => {
    const f = await fixture(new ApplicationProvider()), r = await assess(f), a = r.attempts[0]!.assessment!;
    expect(a.semanticCorrectness, "Schema and quote checks cannot certify semantic correctness.").not.toBe("semantic_ready");
    expect(a.semanticCorrectness).toBe("unproven"); expect(a.envelope!.response_schema_valid).toBe(true); expect(a.publicSummary).toContain("moon");
  });
  it("P1-05 G5: prepared interactive Review survives a restart", async () => {
    const f = await fixture(), a = f.kernel.createReview("Persistent suggestion", session), p = await f.kernel.prepareManifest(a.id, a.version, {}, false, session);
    await f.restart(); expect(f.kernel.readReview(a.id, session).review).toEqual(p.review); expect(f.kernel.inspectManifest(a.id, session)).toEqual(p.manifest);
  });
});
