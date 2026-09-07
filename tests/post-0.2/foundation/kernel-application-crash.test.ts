import { it, expect } from "vitest";
import {
  applicationFixture,
  ApplicationProvider,
  session,
  commit,
} from "../application-fixtures.js";
import { buildProcessDriver, killAtCheckpoint } from "../process-harness.js";
it("G5 actual application process death recovers running as uncertain without any send, then permits a user effect", async () => {
  const provider = new ApplicationProvider(),
    f = await applicationFixture(provider);
  try {
    f.kernel.close();
    const driver = await buildProcessDriver(
      f.root,
      "tests/post-0.2/application-process-driver.ts",
    );
    const point = await killAtCheckpoint(driver, [f.root]);
    expect(point.state).toBe("provider_attempt_running");
    await f.restart();
    const restored = f.kernel.readReview(String(point.reviewId), session);
    expect(restored.review.status).toBe("provider_attempt_uncertain");
    expect(restored.attempts[0]!.status).toBe("uncertain");
    expect(provider.calls).toEqual([]);
    const receipt = commit(f, restored.review, {
      kind: "record_only",
      outcome: "deferred",
      reason: "User continues without retrying",
    });
    expect(receipt.afterProjectStateRevision).toBe(
      restored.projectStateRevision + 1,
    );
    expect(provider.calls).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
