import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { openDatabase, DEFAULT_BUSY_TIMEOUT_MS } from "../src/index.js";
import { SestinaErrorCode, isSestinaError } from "@sestina/schema";
import { makeTempDir, removeTempDir, writeGarbageFile } from "./helpers.js";

describe("openDatabase security pragmas (docs/17 §3.1)", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  it("opens a defensive WAL database with the documented PRAGMA baseline", async () => {
    const db = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      expect(db.pragma("journal_mode")).toBe("wal");
      expect(db.pragma("foreign_keys")).toBe(1);
      expect(db.pragma("busy_timeout")).toBe(DEFAULT_BUSY_TIMEOUT_MS);
      expect(db.pragma("synchronous")).toBe(1); // NORMAL
      expect(db.pragma("trusted_schema")).toBe(0); // OFF
    } finally {
      db.close();
    }
  });

  it("enables SQLite defensive mode (schema table is not writable)", async () => {
    const db = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      // With defensive mode on, even no-op writes to sqlite_schema are denied.
      expect(() =>
        { db.exec("UPDATE sqlite_schema SET sql = sql WHERE name = 'migrations'"); },
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("never enables dynamic extension loading", async () => {
    const db = await openDatabase({ path: join(dir, "sestina.db") });
    try {
      const raw = db.raw as unknown as { loadExtension(name: string): void };
      expect(() => { raw.loadExtension("no_such_extension"); }).toThrow();
    } finally {
      db.close();
    }
  });

  it("honours a caller-provided busy timeout", async () => {
    const db = await openDatabase({ path: join(dir, "sestina.db"), busyTimeoutMs: 250 });
    try {
      expect(db.pragma("busy_timeout")).toBe(250);
    } finally {
      db.close();
    }
  });

  it("supports read-only opens and rejects writes with database_readonly", async () => {
    const writable = await openDatabase({ path: join(dir, "sestina.db") });
    writable.close();

    const db = await openDatabase({ path: join(dir, "sestina.db"), readOnly: true });
    try {
      expect(db.readOnly).toBe(true);
      expect(db.all("SELECT name FROM sqlite_schema").length).toBeGreaterThan(0);
      try {
        db.run("CREATE TABLE should_not_work (x TEXT)");
        expect.unreachable("write on read-only database must throw");
      } catch (err) {
        expect(isSestinaError(err)).toBe(true);
        if (isSestinaError(err)) {
          expect(err.code).toBe(SestinaErrorCode.database_readonly);
        }
      }
    } finally {
      db.close();
    }
  });

  it("reports a non-SQLite file as database_corrupt without recreating it", async () => {
    const path = join(dir, "not-a-db.db");
    writeGarbageFile(path);
    const before = readFileSync(path, "utf8");

    await expect(openDatabase({ path })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_corrupt;
    });

    // The original file must be preserved — no silent recreation, no empty db.
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);

    // Read-only opens must report the same corruption instead of returning
    // a handle that only fails on the first query.
    await expect(openDatabase({ path, readOnly: true })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_corrupt;
    });
  });

  it("reports an unreachable database path as database_unavailable", async () => {
    await expect(openDatabase({ path: join(dir, "missing-parent", "state.sqlite") })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_unavailable;
    });
  });

  it("supports multiple connections to the same WAL database", async () => {
    const path = join(dir, "sestina.db");
    const a = await openDatabase({ path });
    a.exec("CREATE TABLE scratch (x TEXT NOT NULL)");
    const b = await openDatabase({ path });
    try {
      b.run("INSERT INTO scratch (x) VALUES (?)", "from-b");
      expect(a.get("SELECT x FROM scratch")?.x).toBe("from-b");
    } finally {
      a.close();
      b.close();
    }
  });

  it("maps a lock timeout to a stable storage_busy error", async () => {
    const path = join(dir, "sestina.db");
    const holder = await openDatabase({ path });
    const contender = await openDatabase({ path, busyTimeoutMs: 60 });
    try {
      holder.exec("BEGIN IMMEDIATE");
      try {
        contender.run("INSERT INTO migrations (version) VALUES (999)");
        expect.unreachable("contender write must hit the lock timeout");
      } catch (err) {
        expect(isSestinaError(err)).toBe(true);
        if (isSestinaError(err)) {
          expect(err.code).toBe(SestinaErrorCode.storage_busy);
          expect(err.status).toBe(503);
        }
      }
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
      contender.close();
    }
  });
});
