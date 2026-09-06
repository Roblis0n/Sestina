import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  previewKernelMigration,
  migrateKernelProject,
  recoverKernelMigration,
} from "@sestina/core";
import { openDatabase, withTransaction } from "@sestina/storage";
import { oldCorpus } from "../legacy-fixtures.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => {
  corpus = await oldCorpus();
});
afterAll(async () => {
  await corpus?.cleanup();
});
it.each(["missing_binding", "corrupt", "future", "partial", "unknown_trigger"])(
  "G2: %s input is refused without changing its files",
  async (mode) => {
    const p = await corpus.project(20),
      path = join(p.root, ".sestina/state.sqlite"),
      brief = join(p.root, ".sestina/research-brief.yaml");
    try {
      if (mode === "missing_binding") await rename(brief, `${brief}.preserved`);
      else if (mode === "corrupt")
        await writeFile(path, "synthetic non-database");
      else {
        const db = new DatabaseSync(path);
        try {
          db.exec(
            mode === "future"
              ? "INSERT INTO migrations(version,name,status,runtime_version,started_at,finished_at) VALUES(26,'synthetic future','completed','future',1,1)"
              : mode === "unknown_trigger"
                ? "CREATE TRIGGER synthetic_unknown_trigger AFTER UPDATE ON research_projects BEGIN SELECT 1; END"
                : "DELETE FROM migrations WHERE version=19",
          );
        } finally {
          db.close();
        }
      }
      const before = await readFile(path);
      await expect(previewKernelMigration(p.root)).rejects.toBeDefined();
      expect(await readFile(path)).toEqual(before);
    } finally {
      await p.cleanup();
    }
  },
);
it("G2: recovery refuses an unknown replacement database and preserves it", async () => {
  const p = await corpus.project(20),
    path = join(p.root, ".sestina/state.sqlite");
  try {
    await expect(
      migrateKernelProject({
        projectRoot: p.root,
        faultInjection(point) {
          if (point === "database_installed") throw Error("interrupt");
        },
      }),
    ).rejects.toBeDefined();
    const unknown = Buffer.from("unrecognized synthetic replacement");
    await writeFile(path, unknown);
    await expect(recoverKernelMigration(p.root)).rejects.toBeDefined();
    expect(await readFile(path)).toEqual(unknown);
  } finally {
    await p.cleanup();
  }
});
it("G2: a tampered pre-migration backup is never used for recovery", async () => {
  const p = await corpus.project(20);
  try {
    await expect(
      migrateKernelProject({
        projectRoot: p.root,
        faultInjection(point) {
          if (point === "old_moved") throw Error("interrupt");
        },
      }),
    ).rejects.toBeDefined();
    const j = JSON.parse(
      await readFile(join(p.root, ".sestina/.kernel-migration.json"), "utf8"),
    );
    const backup = join(
      p.root,
      `.sestina/kernel-migrations/${j.runId}/backup/state.sqlite`,
    );
    await writeFile(backup, "corrupt synthetic backup");
    await expect(recoverKernelMigration(p.root)).rejects.toBeDefined();
    expect(await readFile(backup, "utf8")).toBe("corrupt synthetic backup");
  } finally {
    await p.cleanup();
  }
});
it("G2: an existing runtime cannot write while maintenance owns the project", async () => {
  const p = await corpus.project(20);
  const db = await openDatabase({
    path: join(p.root, ".sestina/state.sqlite"),
    migrate: false,
  });
  let checked = false;
  try {
    await expect(
      migrateKernelProject({
        projectRoot: p.root,
        faultInjection(point) {
          if (point === "before_backup") {
            checked = true;
            expect(() =>
              withTransaction(db, () =>
                db.run("UPDATE research_projects SET version=version+1"),
              ),
            ).toThrow();
            throw Error("stop before rename of open Windows file");
          }
        },
      }),
    ).rejects.toBeDefined();
    expect(checked).toBe(true);
  } finally {
    db.close();
    await p.cleanup();
  }
});
it("G2: copy preflight sees committed WAL content and leaves source bytes intact", async () => {
  const p = await corpus.project(20),
    path = join(p.root, ".sestina/state.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=123",
    );
    const before = await readFile(path);
    const wal = await readFile(`${path}-wal`);
    const preview = await previewKernelMigration(p.root);
    expect(preview.sourceWalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(`${path}-wal`)).toEqual(wal);
  } finally {
    db.close();
    await p.cleanup();
  }
});
it.each(["database_installed", "brief_installed"])(
  "G2: recovery preserves and rejects an unrecorded WAL after %s",
  async (point) => {
    const p = await corpus.project(20),
      path = join(p.root, ".sestina/state.sqlite"),
      walPath = `${path}-wal`;
    try {
      await expect(
        migrateKernelProject({
          projectRoot: p.root,
          faultInjection(stage) {
            if (stage === point) throw Error("interrupt");
          },
        }),
      ).rejects.toBeDefined();
      const database = await readFile(path),
        wal = Buffer.from("synthetic unknown WAL that must not be discarded");
      await writeFile(walPath, wal);
      await expect(recoverKernelMigration(p.root)).rejects.toMatchObject({
        code: "recovery_required",
      });
      expect(await readFile(path)).toEqual(database);
      expect(await readFile(walPath)).toEqual(wal);
    } finally {
      await p.cleanup();
    }
  },
);
