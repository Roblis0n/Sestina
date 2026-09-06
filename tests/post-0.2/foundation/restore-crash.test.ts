import { beforeAll, afterAll, it, expect } from "vitest";
import {
  migrateKernelProject,
  recoverKernelMigration,
  previewKernelMigration,
  openKernelProject,
} from "@sestina/core";
import { oldCorpus } from "../legacy-fixtures.js";
import { buildProcessDriver, killAtCheckpoint } from "../process-harness.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>, entry: string;
beforeAll(async () => {
  corpus = await oldCorpus();
  entry = await buildProcessDriver(corpus.root);
});
afterAll(async () => {
  await corpus?.cleanup();
});
it.each([
  "restore_prepared",
  "restore_database_moved",
  "restore_database_installed",
  "restore_before_completion",
])(
  "G2: hard death at %s never selects a half-restored database pair",
  async (point) => {
    const p = await corpus.project(20);
    try {
      await migrateKernelProject({ projectRoot: p.root });
      expect(
        await killAtCheckpoint(entry, [p.root, "downgrade", point]),
      ).toEqual({ stage: point });
      await expect(openKernelProject(p.root)).rejects.toMatchObject({
        code: "recovery_required",
      });
      expect((await recoverKernelMigration(p.root)).stage).toBe("rolled_back");
      expect((await previewKernelMigration(p.root)).sourceSchema).toBe(20);
    } finally {
      await p.cleanup();
    }
  },
);
