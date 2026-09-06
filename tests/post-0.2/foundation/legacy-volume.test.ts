import { beforeAll, afterAll, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { migrateKernelProject, openKernelProject, previewKernelMigration } from "@sestina/core";
import { readKernelSnapshot, createResearchStore } from "@sestina/research-store";
import provenance from "../legacy-volume-provenance.json" with { type: "json" };
import { value } from "../factory.js";
let corpus: string;
beforeAll(async () => { await mkdir(resolve(".tmp"), { recursive: true }); corpus = await mkdtemp(resolve(".tmp/old-volume-proof-")); execFileSync(process.execPath, [resolve("scripts/materialize-post-0.2-volume.mjs"), corpus], { windowsHide: true, stdio: "pipe", maxBuffer: 2_097_152 }); });
afterAll(async () => { if (corpus) await rm(corpus, { recursive: true, force: true }); });
it.each(provenance.fixtures)("G2/G3: pinned $kind migrates without fabricated objects or content loss", async f => {
  const root = await mkdtemp(join(tmpdir(), "sestina-volume-copy-"));
  try {
    await cp(join(corpus, "volume", f.kind, ".sestina"), join(root, ".sestina"), { recursive: true });
    expect((await previewKernelMigration(root)).sourceSchema).toBe(20);
    await migrateKernelProject({ projectRoot: root }); const db = await openKernelProject(root);
    try {
      const s = readKernelSnapshot(db, f.projectId); expect(s.head.revision).toBe(1);
      expect(s.state.objects.filter(o => o.kind === "decision")).toHaveLength(f.expected.decisionCount);
      expect(s.state.objects.filter(o => o.kind === "brief")).toHaveLength(f.expected.briefCount);
      if (f.kind === "long_brief") expect(JSON.stringify(s.state.objects.find(o => o.kind === "brief")!.data).length).toBeGreaterThan(50000);
      if (f.kind === "large_project") { const store = createResearchStore(db); const seen = new Set<string>(); let cursor: string | undefined; do { const page = value(store.decisions.listByScope(f.projectId, undefined, { limit: 100, cursor })); for (const item of page.items) { expect(seen.has(item.id)).toBe(false); seen.add(item.id); } cursor = page.nextCursor; } while (cursor); expect(seen.size).toBe(1000); }
    } finally { db.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
