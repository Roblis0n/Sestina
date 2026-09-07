import { afterEach, expect, it } from "vitest";
import { parseCanonicalEffect } from "@sestina/core";
import {
  createKernelRepositories,
  readKernelSnapshot,
} from "@sestina/research-store";
import {
  applicationFixture,
  session,
  ready,
  commit,
} from "../application-fixtures.js";
const fixtures: Awaited<ReturnType<typeof applicationFixture>>[] = [];
it("G4 rejects a partial Evidence source binding instead of silently dropping its revision", () => {
  expect(() =>
    parseCanonicalEffect({
      kind: "add_evidence",
      evidence: {
        kind: "literature_source",
        summary: "Synthetic citation",
        state: "current",
        inferenceCapacity: "descriptive",
        revisionId: "rrev_00000000000000000000000000",
        provenance: { citation: "Synthetic source" },
      },
      links: [],
      reason: "Record source",
    }),
  ).toThrow("invalid_record");
});
it("G4 Issue preview refuses a target from another project before offering user confirmation", async () => {
  const f = await applicationFixture(),
    other = await applicationFixture();
  fixtures.push(f, other);
  const r = await ready(f);
  expect(() =>
    f.kernel.prepareEffect(
      r.id,
      r.version,
      {
        kind: "create_or_resolve_issue",
        mode: "create",
        reason: "Investigate",
        issue: {
          kind: "evidence_boundary",
          summary: "Synthetic issue",
          target: { kind: "artifact", artifactId: other.artifact.artifact.id },
          violatedCriterion: "Needs support",
          rationaleConcepts: ["inference"],
          sourceArtifactId: f.artifact.artifact.id,
          sourceRevisionId: f.artifact.revision.id,
          sourceRevisionContentHash: f.artifact.revision.content.contentHash,
          lineageRootRevisionId: f.artifact.revision.id,
        },
      },
      session,
    ),
  ).toThrow("relation_mismatch");
});
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.cleanup();
});
it("G4 rejects missing target identity and version before preview construction", () => {
  expect(() =>
    parseCanonicalEffect({
      kind: "patch_brief",
      changes: { currentTask: "Different task" },
      baseVersionId: "rbrf_example",
      reason: "User change",
    }),
  ).toThrow("invalid_record");
});
it("G4 rejects unknown nested authority fields instead of silently dropping them", () => {
  expect(() =>
    parseCanonicalEffect({
      kind: "create_decision",
      mode: "create",
      statement: "Bounded choice",
      rationale: "User rationale",
      scope: { kind: "project", actor: "user" },
      reopenConditions: [],
      reason: "User change",
    }),
  ).toThrow("invalid_record");
});
it("G5 allows a stale draft to be explicitly cancelled without a canonical mutation", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  const a = await ready(f),
    p = f.kernel.prepareEffect(
      a.id,
      a.version,
      { kind: "record_only", outcome: "deferred", reason: "Later" },
      session,
    );
  commit(f, await ready(f), {
    kind: "record_only",
    outcome: "rejected",
    reason: "No change",
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
  const stale = f.kernel.readReview(a.id, session);
  expect(f.kernel.cancel(a.id, stale.review.version, session).status).toBe(
    "cancelled",
  );
  expect(f.kernel.readReview(a.id, session).projectStateRevision).toBe(
    stale.projectStateRevision,
  );
});
it("G4 ordinary continuation is not falsely recorded as compensation", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  const a = await ready(f);
  commit(f, a, { kind: "record_only", outcome: "deferred", reason: "Later" });
  const b = f.kernel.createReview("Continue investigation", session, a.id);
  const r = await f.kernel.skipAssessment(b.id, b.version, session);
  const receipt = commit(f, r, {
    kind: "record_only",
    outcome: "reference_only",
    reason: "Keep context",
  });
  const event = createKernelRepositories(f.kernel.database).events.getById(
    f.projectId,
    receipt.revisionEventId,
  );
  expect(event!.compensatesReceiptId).toBeNull();
});
it("G4 explicit compensation uses a new confirmed effect and leaves the original terminal record immutable", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  const a = await ready(f),
    original = commit(f, a, {
      kind: "create_decision",
      mode: "create",
      statement: "Initial choice",
      rationale: "Initial reason",
      scope: { kind: "project" },
      reopenConditions: [],
      reason: "User choice",
    });
  const prior = f.kernel.readReview(a.id, session).review;
  const next = await f.kernel.prepareCompensation(
    original.id,
    {
      kind: "create_decision",
      mode: "create",
      replaces: {
        targetId: original.resultingObjects[0]!.id,
        expectedVersion: 1,
      },
      statement: "Replacement choice",
      rationale: "New reason",
      scope: { kind: "project" },
      reopenConditions: [],
      reason: "User supersedes earlier choice",
    },
    session,
  );
  expect(next.effectDraft!.preview).toMatchObject({
    compensatesReceiptId: original.id,
    rollbackMode: "compensating_only",
  });
  await f.restart();
  const receipt = f.kernel.commitEffect(
    next.id,
    next.version,
    next.effectDraft!.previewHash,
    next.effectDraft!.authorityCommandId!,
    session,
  );
  expect(receipt.afterProjectStateRevision).toBe(
    original.afterProjectStateRevision + 1,
  );
  expect(
    createKernelRepositories(f.kernel.database).events.getById(
      f.projectId,
      receipt.revisionEventId,
    )!.compensatesReceiptId,
  ).toBe(original.id);
  expect(f.kernel.readReview(a.id, session).review).toEqual(prior);
});
it("G4 Kernel allocates nested Brief identities and binds the exact preview across restart", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  const brief = readKernelSnapshot(
    f.kernel.database,
    f.projectId,
  ).state.objects.find((o) => o.kind === "brief")!;
  const r = await ready(f),
    p = f.kernel.prepareEffect(
      r.id,
      r.version,
      {
        kind: "patch_brief",
        targetId: brief.id,
        expectedVersion: brief.version,
        baseVersionId: brief.data.currentVersionId,
        reason: "New constraint",
        changes: {
          fixedDecisions: [
            {
              statement: "Stay observational",
              scope: {
                target: {
                  kind: "artifact",
                  artifactId: f.artifact.artifact.id,
                },
                operations: ["rewrite"],
              },
            },
          ],
        },
      },
      session,
    );
  const preview = p.effectDraft!.preview as {
    objects: { after: { versions: { fixedDecisions: { id: string }[] }[] } }[];
  };
  const assigned =
    preview.objects[0]!.after.versions.at(-1)!.fixedDecisions[0]!.id;
  expect(assigned).toMatch(/^rbrf_/);
  await f.restart();
  f.kernel.commitEffect(
    p.id,
    p.version,
    p.effectDraft!.previewHash,
    p.effectDraft!.authorityCommandId!,
    session,
  );
  expect(
    JSON.stringify(readKernelSnapshot(f.kernel.database, f.projectId).state),
  ).toContain(assigned);
});
