import { beforeAll, afterAll, it, expect } from "vitest";
import { migrateKernelProject, openKernelProject } from "@sestina/core";
import {
  readKernelSnapshot,
  projectKernelContext,
} from "@sestina/research-store";
import { oldCorpus } from "../legacy-fixtures.js";
import { ids } from "../kernel-fixtures.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => {
  corpus = await oldCorpus();
});
afterAll(async () => {
  await corpus?.cleanup();
});
it("G3: unknown selected Issues and a forged snapshot cannot silently produce a valid context", async () => {
  const p = await corpus.project(20);
  try {
    await migrateKernelProject({ projectRoot: p.root });
    const db = await openKernelProject(p.root);
    try {
      const s = readKernelSnapshot(db, p.entry.projectId);
      expect(() =>
        projectKernelContext(s, "Synthetic", {
          issueIds: [ids.create("riss_")],
        }),
      ).toThrow();
      expect(() =>
        projectKernelContext(
          { ...s, head: { ...s.head, canonicalHash: "0".repeat(64) } },
          "Synthetic",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  } finally {
    await p.cleanup();
  }
});
it("G3: migrated Brief coverage limitations remain explicit in the deterministic projection", async () => {
  const p = await corpus.project(20);
  try {
    await migrateKernelProject({ projectRoot: p.root });
    const db = await openKernelProject(p.root);
    try {
      const context = projectKernelContext(
        readKernelSnapshot(db, p.entry.projectId),
        "Synthetic",
      );
      expect(
        context.limitations.some(
          (s) => s.includes("knownUnknowns") && s.includes("not_provided"),
        ),
      ).toBe(true);
    } finally {
      db.close();
    }
  } finally {
    await p.cleanup();
  }
});
