import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { previewKernelMigration, migrateKernelProject, openKernelProject, recoverKernelMigration, type KernelMigrationFaultPoint } from "@sestina/core";
import { readKernelSnapshot } from "@sestina/research-store";
import { oldCorpus } from "../legacy-fixtures.js";

let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => { corpus = await oldCorpus(); });
afterAll(async () => { await corpus?.cleanup(); });
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
it.each([21, 22, 23, 24, 25] as const)("G2: migration %i interruption records only migrations actually committed", async (version) => {
  const p = await corpus.project(20);
  try {
    await expect(migrateKernelProject({ projectRoot: p.root, faultInjection(point) { if (point === `migration_${version}`) throw new Error("stop at actual boundary"); } })).rejects.toMatchObject({ code: "migration_failed" });
    const journal = JSON.parse(await readFile(join(p.root, ".sestina/.kernel-migration.json"), "utf8"));
    const staged = new DatabaseSync(join(p.root, `.sestina/kernel-migrations/${journal.runId}/staging/state.sqlite`), { readOnly: true });
    try { expect(staged.prepare("SELECT max(version) version FROM migrations WHERE status='completed'").get()?.version).toBe(version); } finally { staged.close(); }
    expect(journal.completedMigrationVersions).toEqual(Array.from({length: version - 20}, (_, i) => i + 21));
  } finally { await p.cleanup(); }
});
it.each([16, 17, 18, 19, 20])("G2: schema %i migrates only a copy, keeps real historical semantics and establishes one baseline", async (schema) => {
  const p = await corpus.project(schema);
  try {
    const path = join(p.root, ".sestina/state.sqlite"); const before = await hash(path);
    const preview = await previewKernelMigration(p.root); expect(preview.sourceSchema).toBe(schema); expect(await hash(path)).toBe(before);
    const migrated = await migrateKernelProject({ projectRoot: p.root }); expect(migrated.stage).toBe("swapped");
    const db = await openKernelProject(p.root);
    try {
      const snapshot = readKernelSnapshot(db, p.entry.projectId);
      expect(snapshot.head.revision).toBe(1); expect(db.all("SELECT * FROM research_project_state_events")).toHaveLength(1);
      expect(db.all("SELECT * FROM research_transition_receipts")).toHaveLength(0);
      expect(snapshot.state.objects.filter((o) => o.kind === "decision")).toHaveLength(1);
      expect(snapshot.state.objects.filter((o) => o.kind === "evidence")).toHaveLength(0);
      expect(db.all("SELECT * FROM research_legacy_mappings WHERE classification='lossy'")).toHaveLength(2);
      expect(db.all("SELECT * FROM research_reviews WHERE status='disposed'")).toHaveLength(5);
      expect(() => db.run("DELETE FROM research_room_receipts")).toThrow();
      if (schema >= 19) expect(snapshot.state.objects.filter((o) => o.kind === "memory").map((o) => o.data.state).sort()).toEqual(["active", "candidate", "expired", "forgotten", "retired", "stale"]);
      const journal = JSON.parse(await readFile(join(p.root, ".sestina/.kernel-migration.json"), "utf8"));
      expect(await hash(join(p.root, `.sestina/kernel-migrations/${migrated.runId}/backup/state.sqlite`))).toBe(journal.backupDatabaseHash);
    } finally { db.close(); }
  } finally { await p.cleanup(); }
});
it.each(["before_backup", "backup_verified", "copied", "migration_21", "backfilled", "before_validation", "validated", "before_swap"] as KernelMigrationFaultPoint[])("G2: failure at %s keeps the source byte-identical and explicitly recoverable", async (point) => {
  const p = await corpus.project(20); const path = join(p.root, ".sestina/state.sqlite"); const before = await hash(path);
  try {
    await expect(migrateKernelProject({ projectRoot: p.root, faultInjection(stage) { if (stage === point) throw new Error("synthetic crash"); } })).rejects.toMatchObject({ code: "migration_failed" });
    expect(await hash(path)).toBe(before);
    await expect(openKernelProject(p.root)).rejects.toMatchObject({ code: "recovery_required" });
    expect((await recoverKernelMigration(p.root)).stage).toBe("rolled_back"); expect(await hash(path)).toBe(before);
  } finally { await p.cleanup(); }
});
it.each(["old_moved", "database_installed", "brief_installed", "before_completion"] as KernelMigrationFaultPoint[])("G2: an interrupted pair switch at %s selects a verified complete pair", async (point) => {
  const p = await corpus.project(20);
  try {
    await expect(migrateKernelProject({ projectRoot: p.root, faultInjection(stage) { if (stage === point) throw new Error("synthetic crash"); } })).rejects.toMatchObject({ code: "migration_failed" });
    const recovered = await recoverKernelMigration(p.root);
    expect(recovered.stage).toBe(["brief_installed", "before_completion"].includes(point) ? "swapped" : "rolled_back");
    if (recovered.stage === "swapped") { const db = await openKernelProject(p.root); db.close(); }
    else expect((await previewKernelMigration(p.root)).sourceSchema).toBe(20);
  } finally { await p.cleanup(); }
});
