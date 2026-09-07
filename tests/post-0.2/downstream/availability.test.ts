import { it, expect } from "vitest";
import { readKernelSnapshot } from "@sestina/research-store";
import { applicationFixture, ApplicationProvider, session, commit } from "../application-fixtures.js";
it.each(["accepted", "modified_accepted", "direction_changed"] as const)("P1-01 G4: actual Provider timeout cannot veto %s", async disposition => {
  const provider = new ApplicationProvider("timeout"), f = await applicationFixture(provider);
  try {
    const a = f.kernel.createReview("User suggestion", session), p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
    let r = await f.kernel.confirmManifest(a.id, p.review.version, p.manifest.identityHash, session); r = f.kernel.prepareAttempt(a.id, r.version, session);
    await f.kernel.startAttempt(a.id, r.version, p.manifest.identityHash, session);
    const state = f.kernel.readReview(a.id, session); expect(state.attempts[0]!.failureCode).toBe("provider_timeout"); expect(provider.calls).toHaveLength(1);
    const brief = readKernelSnapshot(f.kernel.database, f.projectId).state.objects.find((o) => o.kind === "brief")!;
    const payload = disposition === "direction_changed" ? { kind: "formal_direction_change", targetId: brief.id, expectedVersion: brief.version, baseVersionId: brief.data.currentVersionId, newQuestion: "Synthetic new direction?", impactSummary: "Reconfirm context", reason: "User decides despite missing assessment" } : { kind: "create_decision", mode: "create", statement: disposition === "modified_accepted" ? "Synthetic bounded edit." : "Synthetic accepted choice.", rationale: "User decision", scope: { kind: "project" }, reopenConditions: [], reason: "User decides despite missing assessment" };
    expect(commit(f, state.review, payload).resultingObjects.length > 0).toBe(true);
  } finally { await f.cleanup(); }
});
it("P1-01/P1-05 G5: skipping the pending Provider attempt preserves a resumable user Review", async () => {
  const provider = new ApplicationProvider(), f = await applicationFixture(provider);
  try {
    const a = f.kernel.createReview("User suggestion", session), p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
    const ready = await f.kernel.skipAssessment(a.id, p.review.version, session); expect(provider.calls).toHaveLength(0);
    await f.restart(); expect(f.kernel.readReview(a.id, session).review).toEqual(ready); expect(f.kernel.inspectManifest(a.id, session)!.exactRequestBody).toBeNull(); expect(provider.calls).toHaveLength(0);
  } finally { await f.cleanup(); }
});
