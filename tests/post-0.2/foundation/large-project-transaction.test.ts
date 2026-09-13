import { it, expect } from "vitest";
import { channel } from "node:diagnostics_channel";
import { workspaceVolumeFixture } from "../workspace-volume-fixture.js";
import { session, commit } from "../application-fixtures.js";

it("a full-sized bilingual Brief does not prevent an explicitly confirmed canonical transaction", async () => {
  const f = await workspaceVolumeFixture();
  const measurements: unknown[] = [];
  const events = channel("sestina.kernel.canonical-duration");
  const observe = (value: unknown) => measurements.push(value);
  events.subscribe(observe);
  try {
    const before = f.kernel.brief(session);
    const draft = f.kernel.createReview(
      "Retain a bounded local conclusion",
      session,
    );
    const skipped = await f.kernel.skipAssessment(
      draft.id,
      draft.version,
      session,
    );
    const receipt = commit(f, skipped, {
      kind: "record_only",
      outcome: "reference_only",
      reason: "Explicit synthetic conclusion",
    });
    expect(receipt.effectKind).toBe("record_only");
    expect(measurements).toEqual([
      expect.objectContaining({
        completed: true,
        durationMs: expect.any(Number),
      }),
    ]);
    expect(f.kernel.brief(session).brief).toEqual(before.brief);
    expect(
      f.kernel.readReview(draft.id, session).review.terminalOutcome,
    ).not.toBeNull();
  } finally {
    events.unsubscribe(observe);
    await f.cleanup();
  }
});
