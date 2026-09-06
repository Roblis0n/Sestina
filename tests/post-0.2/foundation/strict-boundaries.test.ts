import { beforeAll, afterAll, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { openDatabase, KERNEL_MIGRATIONS } from "@sestina/storage";
import { migrateKernelProject, openKernelProject } from "@sestina/core";
import { createResearchStore, createResearchUnitOfWork, readKernelSnapshot } from "@sestina/research-store";
import { kernelHash } from "@sestina/research";
import { oldCorpus } from "../legacy-fixtures.js";
import { at, ids, capability } from "../kernel-fixtures.js";
import { USER, value } from "../factory.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => { corpus = await oldCorpus(); });
afterAll(async () => { await corpus?.cleanup(); });
it("G2: direct in-place target migration refusal does not change old journal mode or database bytes", async () => {
  const p = await corpus.project(20), path = join(p.root, ".sestina/state.sqlite");
  try { const raw = new DatabaseSync(path); raw.exec("PRAGMA journal_mode=DELETE"); raw.close(); const before = await readFile(path); await expect(openDatabase({ path, migrate: { migrations: KERNEL_MIGRATIONS } })).rejects.toBeDefined(); expect(await readFile(path)).toEqual(before); } finally { await p.cleanup(); }
});
it("G2: an unknown target schema trigger is rejected before any writable open", async () => {
  const p = await corpus.project(20);
  try {
    await migrateKernelProject({ projectRoot: p.root });
    const raw = new DatabaseSync(join(p.root, ".sestina/state.sqlite"));
    raw.exec("CREATE TRIGGER foreign_target_trigger AFTER UPDATE ON research_reviews BEGIN SELECT 1; END"); raw.close();
    const accepted = await openKernelProject(p.root).then(db => { db.close(); return true; }, () => false);
    expect(accepted).toBe(false);
  } finally { await p.cleanup(); }
});
it("G3: an empty privacy command cannot invent a canonical revision or receipt", async () => {
  const p = await corpus.project(20);
  try {
    await migrateKernelProject({ projectRoot: p.root }); const db = await openKernelProject(p.root);
    try {
      const uow = createResearchUnitOfWork(db, { authorizeGovernance: c => c.authorityCapability === capability }).kernel!;
      const m = value(createResearchStore(db).workingMemory.listByProject(p.entry.projectId, { limit: 100 })).items[0]!;
      const result = uow.commitCanonical({ projectId: p.entry.projectId, reviewId: null, expectedReviewVersion: null, expectedProjectStateRevision: 1, authorityCommandId: ids.create("rpev_"), effectId: ids.create("rpev_"), effectKind: "privacy_redaction", previewHash: kernelHash({ id: m.id }), objectVersions: [{ kind: "memory", id: m.id, version: m.version }], actor: USER, authorityCapability: capability, publicReason: "Synthetic empty request.", receiptId: ids.create("rrcp_"), eventId: ids.create("rpev_"), createdAt: at }, () => {});
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_record" } });
      expect(readKernelSnapshot(db, p.entry.projectId).head.revision).toBe(1);
      expect(db.all("SELECT * FROM research_transition_receipts")).toHaveLength(0);
    } finally { db.close(); }
  } finally { await p.cleanup(); }
});
