import { beforeAll, afterAll, it, expect } from "vitest";
import {
  migrateKernelProject,
  recoverKernelMigration,
  openKernelProject,
  previewKernelMigration,
} from "@sestina/core";
import {
  createResearchUnitOfWork,
  readKernelSnapshot,
  recoverKernelWorkflows,
} from "@sestina/research-store";
import { oldCorpus } from "../legacy-fixtures.js";
import { buildProcessDriver, killAtCheckpoint } from "../process-harness.js";
import { value } from "../factory.js";
import { at } from "../kernel-fixtures.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>, entry: string;
beforeAll(async () => {
  corpus = await oldCorpus();
  entry = await buildProcessDriver(corpus.root);
});
afterAll(async () => {
  await corpus?.cleanup();
});
it.each([
  "before_backup",
  "backup_database_copied",
  "staging_database_copied",
  "old_database_moved",
  "backup_verified",
  "copied",
  "migration_21",
  "migration_22",
  "migration_23",
  "migration_24",
  "migration_25",
  "before_validation",
  "before_swap",
  "old_moved",
  "database_installed",
  "brief_installed",
  "before_completion",
])(
  "G2: hard process death at %s recovers exactly one verified database pair",
  async (point) => {
    const p = await corpus.project(20);
    try {
      expect(
        await killAtCheckpoint(entry, [p.root, "migration", point]),
      ).toEqual({ stage: point });
      const restored = await recoverKernelMigration(p.root);
      if (restored.stage === "swapped") {
        const db = await openKernelProject(p.root);
        try {
          expect(readKernelSnapshot(db, p.entry.projectId).head.revision).toBe(
            1,
          );
        } finally {
          db.close();
        }
      } else
        expect((await previewKernelMigration(p.root)).sourceSchema).toBe(20);
    } finally {
      await p.cleanup();
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
  "after_commit",
])(
  "G3: hard process death at %s has a durable all-or-zero canonical result",
  async (point) => {
    const p = await corpus.project(20);
    try {
      await migrateKernelProject({ projectRoot: p.root });
      expect(
        await killAtCheckpoint(entry, [
          p.root,
          "transaction",
          point,
          p.entry.projectId,
        ]),
      ).toEqual({ stage: point });
      const db = await openKernelProject(p.root);
      try {
        const committed = point === "after_commit";
        const snapshot = readKernelSnapshot(db, p.entry.projectId);
        expect(snapshot.head.revision).toBe(committed ? 2 : 1);
        expect(
          snapshot.state.objects.filter((o) => o.kind === "decision"),
        ).toHaveLength(committed ? 2 : 1);
        expect(
          db.all("SELECT * FROM research_transition_receipts"),
        ).toHaveLength(committed ? 1 : 0);
      } finally {
        db.close();
      }
    } finally {
      await p.cleanup();
    }
  },
);
it.each([
  "draft",
  "manifest_prepared",
  "committed",
  "manifest_confirmed",
  "provider_attempt_prepared",
  "provider_attempt_running",
  "provider_attempt_uncertain",
  "provider_attempt_failed",
  "assessment_recorded",
  "stale",
  "disposed",
  "cancelled",
])(
  "G3: hard process death preserves Review %s and never resends a Provider request",
  async (status) => {
    const p = await corpus.project(20);
    try {
      await migrateKernelProject({ projectRoot: p.root });
      const saved = await killAtCheckpoint(entry, [
        p.root,
        "workflow",
        status,
        p.entry.projectId,
      ]);
      const db = await openKernelProject(p.root);
      try {
        const repo = createResearchUnitOfWork(db).kernel!.repositories;
        expect(
          repo.reviews.getById(p.entry.projectId, String(saved.reviewId))
            ?.status,
        ).toBe(status);
        value(recoverKernelWorkflows(db, p.entry.projectId, at));
        expect(
          repo.reviews.getById(p.entry.projectId, String(saved.reviewId))
            ?.status,
        ).toBe(
          status === "provider_attempt_running"
            ? "provider_attempt_uncertain"
            : status,
        );
        expect(
          value(recoverKernelWorkflows(db, p.entry.projectId, at)),
        ).toEqual([]);
      } finally {
        db.close();
      }
    } finally {
      await p.cleanup();
    }
  },
);
