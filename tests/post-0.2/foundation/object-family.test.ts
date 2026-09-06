import { beforeAll, afterAll, it, expect } from "vitest";
import { migrateKernelProject, openKernelProject } from "@sestina/core";
import {
  createResearchStore,
  createResearchUnitOfWork,
  readKernelSnapshot,
  projectKernelContext,
} from "@sestina/research-store";
import {
  parseArgumentEvidence,
  createResearchIssue,
  createRevisionEpisode,
  FixedClock,
  kernelHash,
  type KernelCanonicalCommand,
} from "@sestina/research";
import { oldCorpus } from "../legacy-fixtures.js";
import { ids, at, capability, prepare, decision } from "../kernel-fixtures.js";
import { USER, value } from "../factory.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => {
  corpus = await oldCorpus();
});
afterAll(async () => {
  await corpus?.cleanup();
});
const ports = { clock: new FixedClock(at), idFactory: ids },
  source = { actor: USER, authority: "user_recorded" as const, recordedAt: at };
it("G3: Evidence provenance, Issue and Episode objects use the same canonical transaction foundation", async () => {
  const p = await corpus.project(20);
  try {
    await migrateKernelProject({ projectRoot: p.root });
    const db = await openKernelProject(p.root);
    try {
      const projectId = p.entry.projectId,
        store = createResearchStore(db),
        uow = createResearchUnitOfWork(db, {
          authorize: (c) => c.authorityCapability === capability,
          authorizeGovernance: (c) => c.authorityCapability === capability,
        }).kernel!;
      const evidence = value(
        parseArgumentEvidence({
          id: ids.create("revd_"),
          projectId,
          kind: "user_decision",
          summary:
            "A synthetic normative user preference, not empirical support.",
          state: "current",
          inferenceCapacity: "normative",
          source,
          version: 1,
        }),
      );
      const e = prepare(uow, projectId, "add_evidence", [
        { kind: "evidence", id: evidence.id, version: 0 },
      ]);
      value(
        uow.commitCanonical(e.command, (r) => {
          value(r.argumentEvidence.create(evidence));
        }),
      );
      const context = projectKernelContext(
        readKernelSnapshot(db, projectId),
        "Synthetic",
        { evidenceIds: [evidence.id] },
      );
      expect(
        context.projection.categories.find((c) => c.kind === "evidence")?.items,
      ).toEqual([
        expect.objectContaining({
          id: evidence.id,
          source,
          inferenceCapacity: "normative",
        }),
      ]);
      const oldIssue = value(
        store.issues.listByStatus(projectId, undefined, { limit: 10 }),
      ).items[0]!;
      const issue = value(
        createResearchIssue(
          {
            ...oldIssue,
            violatedCriterion: "synthetic-new-boundary",
            summary: "Synthetic separately identified Issue.",
            source,
          },
          ports,
        ),
      );
      const i = prepare(uow, projectId, "create_or_resolve_issue", [
        { kind: "issue", id: issue.id, version: 0 },
      ]);
      value(
        uow.commitCanonical(i.command, (r) => {
          value(r.issues.create(issue));
        }),
      );
      const oldEpisode = value(
        store.episodes.listByProject(projectId, { limit: 10 }),
      ).items[0]!;
      const episode = value(
        createRevisionEpisode(
          {
            projectId,
            artifactId: oldEpisode.artifactId,
            lockedStart: oldEpisode.lockedStart,
            source,
          },
          ports,
        ),
      );
      const command: KernelCanonicalCommand = {
        projectId,
        authorityCommandId: ids.create("rpev_"),
        reviewId: null,
        expectedReviewVersion: null,
        expectedProjectStateRevision: 3,
        effectId: ids.create("rpev_"),
        effectKind: "episode_change",
        previewHash: kernelHash(episode),
        objectVersions: [{ kind: "episode", id: episode.id, version: 0 }],
        actor: USER,
        authorityCapability: capability,
        publicReason: "Synthetic explicit new Episode.",
        receiptId: ids.create("rrcp_"),
        eventId: ids.create("rpev_"),
        createdAt: at,
      };
      value(
        uow.commitCanonical(command, (r) => {
          value(r.episodes.create(episode));
        }),
      );
      expect(readKernelSnapshot(db, projectId).head.revision).toBe(4);
      expect(db.all("SELECT * FROM research_transition_receipts")).toHaveLength(
        3,
      );
      expect(
        value(store.argumentEvidence.getById(projectId, evidence.id)),
      ).toEqual(evidence);
      expect(value(store.issues.getById(projectId, issue.id))).toEqual(issue);
      expect(value(store.episodes.getById(projectId, episode.id))).toEqual(
        episode,
      );
    } finally {
      db.close();
    }
  } finally {
    await p.cleanup();
  }
});
it("G3: a compensating command appends a forward revision and retains both proofs", async () => {
  const p = await corpus.project(20);
  try {
    await migrateKernelProject({ projectRoot: p.root });
    const db = await openKernelProject(p.root);
    try {
      const uow = createResearchUnitOfWork(db, {
        authorize: (c) => c.authorityCapability === capability,
      }).kernel!;
      const first = prepare(uow, p.entry.projectId);
      const receipt = value(uow.commitCanonical(first.command, () => {}));
      const object = decision(db, p.entry.projectId),
        next = prepare(uow, p.entry.projectId, "create_decision", [
          { kind: "decision", id: object.id, version: 0 },
        ]);
      value(
        uow.commitCanonical(
          { ...next.command, compensatesReceiptId: receipt.id },
          (r) => {
            value(r.decisions.create(object));
          },
        ),
      );
      expect(readKernelSnapshot(db, p.entry.projectId).head.revision).toBe(3);
      expect(
        uow.repositories.receipts.getById(p.entry.projectId, receipt.id),
      ).toEqual(receipt);
      expect(
        uow.repositories.events
          .listByProject(p.entry.projectId, { limit: 10 })
          .items.find((event) => event.revision === 3)?.compensatesReceiptId,
      ).toBe(receipt.id);
    } finally {
      db.close();
    }
  } finally {
    await p.cleanup();
  }
});
