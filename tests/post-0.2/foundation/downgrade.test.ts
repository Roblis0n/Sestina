import { beforeAll, afterAll, it, expect } from "vitest";
import * as core from "@sestina/core";
import { oldCorpus } from "../legacy-fixtures.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => {
  corpus = await oldCorpus();
});
afterAll(async () => {
  await corpus?.cleanup();
});
it("G2: explicit downgrade restores the verified old backup without reverse migrations", async () => {
  const p = await corpus.project(20);
  try {
    await core.migrateKernelProject({ projectRoot: p.root });
    const restore =
      (
        core as typeof core & {
          restoreKernelPreMigrationBackup?: (root: string) => Promise<unknown>;
        }
      ).restoreKernelPreMigrationBackup ?? core.recoverKernelMigration;
    const result = await restore(p.root);
    expect(result).toMatchObject({ stage: "rolled_back" });
    expect((await core.previewKernelMigration(p.root)).sourceSchema).toBe(20);
  } finally {
    await p.cleanup();
  }
});
