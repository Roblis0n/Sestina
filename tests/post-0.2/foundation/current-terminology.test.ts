import { it, expect } from "vitest";
import {
  applicationFixture,
  ready,
  session,
  commit,
} from "../application-fixtures.js";
import { readKernelSnapshot } from "@sestina/research-store";
it("G11: current effect writes reject generic disposition aliases while canonical Decision accepted remains legal", async () => {
  const f = await applicationFixture();
  try {
    const review = await ready(f);
    for (const kind of [
      "semantic_ready",
      "ledger_only",
      "accepted",
      "modified_accepted",
      "generic_disposition",
    ]) {
      expect(() =>
        f.kernel.prepareEffect(
          review.id,
          review.version,
          { kind, reason: "Synthetic obsolete write alias" } as never,
          session,
        ),
      ).toThrow();
    }
    const result = commit(f, review, {
      kind: "record_only",
      outcome: "reference_only",
      reason: "Current typed record-only outcome",
    });
    expect(result).toBeDefined();
    const receipt = commit(f, await ready(f), {
      kind: "create_decision",
      mode: "create",
      statement: "Keep the bounded research direction",
      rationale: "Synthetic user choice",
      scope: { kind: "project" },
      reopenConditions: [],
      reason: "Explicit research decision",
    });
    expect(
      readKernelSnapshot(f.kernel.database, f.projectId).state.objects.find(
        (o) => o.id === receipt.resultingObjects[0]?.id,
      )?.data.status,
    ).toBe("accepted");
  } finally {
    await f.cleanup();
  }
});
