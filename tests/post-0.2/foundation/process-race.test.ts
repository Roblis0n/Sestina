import { beforeAll, afterAll, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrateKernelProject, openKernelProject } from "@sestina/core";
import { createResearchUnitOfWork, createResearchStore, readKernelSnapshot } from "@sestina/research-store";
import { transitionResearchDecision, FixedClock } from "@sestina/research";
import { oldCorpus } from "../legacy-fixtures.js";
import { buildProcessDriver, raceAtBarrier } from "../process-harness.js";
import { at, prepare } from "../kernel-fixtures.js";
import { USER, value } from "../factory.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>, entry: string;
beforeAll(async () => { corpus = await oldCorpus(); entry = await buildProcessDriver(corpus.root); });
afterAll(async () => { await corpus?.cleanup(); });
it("G3: two processes released together compete for the same Decision and exactly one commits", async () => {
 const p = await corpus.project(20);
 try {
  await migrateKernelProject({ projectRoot: p.root }); const db = await openKernelProject(p.root);
  const store = createResearchStore(db), old = value(store.decisions.listByScope(p.entry.projectId, undefined, { limit: 10 })).items[0]!;
  const uow = createResearchUnitOfWork(db).kernel!, files: string[] = [];
  for (const target of ["accepted", "rejected"] as const) {
   const object = value(transitionResearchDecision(old, target, USER, old.version, `Synthetic competing ${target} decision.`, new FixedClock(at)));
   const prepared = prepare(uow, p.entry.projectId, "create_decision", [{ kind: "decision", id: old.id, version: old.version }]);
   const file = join(p.root, `${target}.json`); await writeFile(file, JSON.stringify({ command: prepared.command, object, expectedVersion: old.version })); files.push(file);
  }
  db.close();
  const results = await raceAtBarrier(entry, p.root, p.entry.projectId, files);
  expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.filter(r => !r.ok)).toEqual([{ ok: false, error: { code: "stale_revision", changedObjects: [{ kind: "decision", id: old.id, version: old.version + 1 }] } }]);
  const reopened = await openKernelProject(p.root);
  try { expect(readKernelSnapshot(reopened, p.entry.projectId).head.revision).toBe(2); expect(reopened.all("SELECT * FROM research_transition_receipts")).toHaveLength(1); expect(value(createResearchStore(reopened).decisions.getById(p.entry.projectId, old.id))?.version).toBe(old.version + 1); } finally { reopened.close(); }
 } finally { await p.cleanup(); }
});
