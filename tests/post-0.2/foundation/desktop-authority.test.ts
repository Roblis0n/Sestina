import { it, expect } from "vitest";
import { KernelApplicationApi } from "../../../packages/application/src/kernel-api.js";
import { TrustedKernelCommands } from "../../../packages/application/src/trusted-commands.js";
import { applicationFixture } from "../application-fixtures.js";

it("a forged renderer confirmation cannot commit without trusted user confirmation", async () => {
  const f = await applicationFixture();
  f.kernel.close();
  const api = new KernelApplicationApi({});
  const desktop = new TrustedKernelCommands(api, async () => false);
  try {
    const s = await api.open({ projectPath: f.root });
    const call = (action: string, body: object = {}) => desktop.execute({ projectId: s.projectId, sessionGeneration: s.sessionGeneration, action, ...body });
    const review = await call("create", { suggestion: "Synthetic renderer proposal" }) as any;
    const skipped = await call("skip_assessment", { reviewId: review.id, expectedVersion: review.version }) as any;
    const preview = await call("prepare_effect", { reviewId: review.id, expectedVersion: skipped.version, payload: { kind: "record_only", outcome: "reference_only", reason: "Synthetic" } }) as any;
    await expect(call("commit", { reviewId: review.id, expectedVersion: preview.version, previewHash: preview.effectDraft.previewHash, authorityCommandId: preview.effectDraft.authorityCommandId, confirmed: true })).rejects.toThrow("confirmation_declined");
  } finally { api.dispose(); await f.cleanup(); }
});

it.each(["expired", "revoked"])("trusted confirmation is discarded when %s before consumption", async mode => {
  const f = await applicationFixture(); f.kernel.close();
  const api = new KernelApplicationApi({}); let now = 0;
  const desktop = new TrustedKernelCommands(api, async () => { if (mode === "expired") now += 60001; else desktop.revoke(); return true; }, () => now);
  try {
    const s = await api.open({ projectPath: f.root });
    const call = (action: string, body: object = {}) => desktop.execute({ projectId: s.projectId, sessionGeneration: s.sessionGeneration, action, ...body });
    const draft = await call("create", { suggestion: "Synthetic confirmation lifetime" }) as any;
    const skipped = await call("skip_assessment", { reviewId: draft.id, expectedVersion: draft.version }) as any;
    const prepared = await call("prepare_effect", { reviewId: draft.id, expectedVersion: skipped.version, payload: { kind: "record_only", outcome: "deferred", reason: "Synthetic" } }) as any;
    await expect(call("commit", { reviewId: draft.id, expectedVersion: prepared.version, previewHash: prepared.effectDraft.previewHash, authorityCommandId: prepared.effectDraft.authorityCommandId, confirmed: true })).rejects.toThrow("confirmation_expired");
    const result = await call("read", { reviewId: draft.id }) as any;
    expect(result.review.terminalOutcome).toBeNull();
    expect(result.review.version).toBe(prepared.version);
  } finally { api.dispose(); await f.cleanup(); }
});
