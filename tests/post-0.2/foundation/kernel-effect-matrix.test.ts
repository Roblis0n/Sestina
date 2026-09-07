import { it, expect } from "vitest";
import {
  readKernelSnapshot,
  createKernelRepositories,
} from "@sestina/research-store";
import {
  applicationFixture,
  ApplicationProvider,
  session,
  ready,
  commit,
} from "../application-fixtures.js";
const kinds = [
  "record_only",
  "create_decision",
  "add_evidence",
  "create_or_resolve_issue",
  "patch_brief",
  "formal_direction_change",
] as const;
function payload(
  f: Awaited<ReturnType<typeof applicationFixture>>,
  kind: (typeof kinds)[number],
) {
  const brief = readKernelSnapshot(
    f.kernel.database,
    f.projectId,
  ).state.objects.find((o) => o.kind === "brief")!;
  const reason = "Explicit synthetic user change";
  if (kind === "record_only") return { kind, outcome: "deferred", reason };
  if (kind === "create_decision")
    return {
      kind,
      mode: "create",
      statement: "Bound the inference",
      rationale: "Observations are limited",
      scope: { kind: "project" },
      reopenConditions: [],
      reason,
    };
  if (kind === "add_evidence")
    return {
      kind,
      evidence: {
        kind: "literature_source",
        state: "current",
        inferenceCapacity: "descriptive",
        summary: "Synthetic source",
        provenance: { citation: "Synthetic citation" },
      },
      links: [],
      reason,
    };
  if (kind === "create_or_resolve_issue")
    return {
      kind,
      mode: "create",
      reason,
      issue: {
        kind: "evidence_boundary",
        summary: "Needs support",
        target: { kind: "artifact", artifactId: f.artifact.artifact.id },
        violatedCriterion: "Causal inference needs support",
        rationaleConcepts: ["inference"],
        sourceArtifactId: f.artifact.artifact.id,
        sourceRevisionId: f.artifact.revision.id,
        sourceRevisionContentHash: f.artifact.revision.content.contentHash,
        lineageRootRevisionId: f.artifact.revision.id,
      },
    };
  return {
    kind,
    targetId: brief.id,
    expectedVersion: brief.version,
    baseVersionId: brief.data.currentVersionId,
    reason,
    ...(kind === "patch_brief"
      ? { changes: { currentTask: "Review bounded observations" } }
      : {
          newQuestion: "Which observation remains unknown?",
          impactSummary: "Reconfirm pending context",
        }),
  };
}
it.each(
  kinds.flatMap((kind) =>
    (["none", "skip", "valid", "timeout", "invalid", "failure"] as const).map(
      (mode) => ({ kind, mode }),
    ),
  ),
)(
  "G4/G5 $kind produces its real user result with assessment=$mode",
  async ({ kind, mode }) => {
    const provider =
        mode === "none"
          ? undefined
          : new ApplicationProvider(mode === "skip" ? "valid" : mode),
      f = await applicationFixture(provider);
    try {
      let r = f.kernel.createReview("Explicit user suggestion", session);
      if (["none", "skip"].includes(mode))
        r = await f.kernel.skipAssessment(r.id, r.version, session);
      else {
        const p = await f.kernel.prepareManifest(
          r.id,
          r.version,
          {},
          true,
          session,
        );
        r = await f.kernel.confirmManifest(
          r.id,
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
        r = f.kernel.readReview(r.id, session).review;
      }
      const before = readKernelSnapshot(f.kernel.database, f.projectId),
        receipt = commit(f, r, payload(f, kind));
      const after = readKernelSnapshot(f.kernel.database, f.projectId),
        review = f.kernel.readReview(r.id, session).review;
      expect(after.head.revision).toBe(before.head.revision + 1);
      expect(receipt.afterProjectStateRevision).toBe(after.head.revision);
      expect(review.terminalOutcome!.receiptId).toBe(receipt.id);
      expect(review.status).toBe(
        kind === "record_only" ? "disposed" : "committed",
      );
      expect(receipt.resultingObjects).toHaveLength(
        kind === "record_only" ? 0 : 1,
      );
      for (const ref of receipt.resultingObjects)
        expect(
          after.state.objects.find(
            (o) => o.kind === ref.kind && o.id === ref.id,
          )?.version,
        ).toBe(ref.version);
      if (kind === "record_only") {
        expect(after.state.objects).toEqual(before.state.objects);
        expect(after.state.outcomes).toHaveLength(
          before.state.outcomes.length + 1,
        );
      }
      expect(provider?.calls.length ?? 0).toBe(
        ["none", "skip"].includes(mode) ? 0 : 1,
      );
    } finally {
      await f.cleanup();
    }
  },
);
it.each([
  "object",
  "review_terminal",
  "revision_event",
  "revision_head",
  "receipt",
  "command_identity",
  "projection_outbox",
  "before_commit",
] as const)(
  "G4 application %s failure rolls back direction, dependent invalidations, terminal and receipt together",
  async (point) => {
    const f = await applicationFixture(undefined, {
      faultInjection: (p) => {
        if (p === point) throw Error("Synthetic transaction failure");
      },
    });
    try {
      const other = await ready(f),
        r = await ready(f),
        p = f.kernel.prepareEffect(
          r.id,
          r.version,
          payload(f, "formal_direction_change"),
          session,
        );
      const before = readKernelSnapshot(f.kernel.database, f.projectId),
        pending = f.kernel.readReview(other.id, session),
        manifest = f.kernel.inspectManifest(other.id, session);
      expect(() =>
        f.kernel.commitEffect(
          p.id,
          p.version,
          p.effectDraft!.previewHash,
          p.effectDraft!.authorityCommandId!,
          session,
        ),
      ).toThrow();
      expect(readKernelSnapshot(f.kernel.database, f.projectId)).toEqual(
        before,
      );
      expect(f.kernel.readReview(other.id, session)).toEqual(pending);
      expect(f.kernel.inspectManifest(other.id, session)).toEqual(manifest);
      expect(f.kernel.readReview(p.id, session).review).toEqual(p);
      expect(
        f.kernel.lookupCommand(p.effectDraft!.authorityCommandId!, session),
      ).toBeUndefined();
      expect(
        createKernelRepositories(f.kernel.database).receipts.listByProject(
          f.projectId,
          { limit: 20 },
        ).items,
      ).toEqual([]);
    } finally {
      await f.cleanup();
    }
  },
);
it("G5 competing starts reserve exactly one attempt before any network activity", async () => {
  const provider = new ApplicationProvider(),
    f = await applicationFixture(provider);
  try {
    const a = f.kernel.createReview("Request", session),
      p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
    let r = await f.kernel.confirmManifest(
      a.id,
      p.review.version,
      p.manifest.identityHash,
      session,
    );
    r = f.kernel.prepareAttempt(a.id, r.version, session);
    const results = await Promise.allSettled([
      f.kernel.startAttempt(a.id, r.version, p.manifest.identityHash, session),
      f.kernel.startAttempt(a.id, r.version, p.manifest.identityHash, session),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(f.kernel.readReview(a.id, session).attempts).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
