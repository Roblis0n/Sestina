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
