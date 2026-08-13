import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  openDatabase,
  checkDatabaseIntegrity,
  type StorageDatabase,
} from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir, corruptDatabaseFile, writeGarbageFile } from "./helpers.js";

describe("Corruption detection (docs/19 §5.3)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    db.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','ik1','p','t','stop',1,1,'internal','{}')");
    db.close();
  });
  afterEach(() => { removeTempDir(dir); });

  it("passes the integrity check on a healthy database", () => {
    const result = checkDatabaseIntegrity(join(dir, "sestina.db"));
    expect(result.ok).toBe(true);
  });

  it("fails the integrity check on a corrupted database", () => {
    corruptDatabaseFile(join(dir, "sestina.db"));
    const result = checkDatabaseIntegrity(join(dir, "sestina.db"));
    expect(result.ok).toBe(false);
  });

  it("enters read-only diagnostics without silently rebuilding the file", async () => {
    const path = join(dir, "sestina.db");
    corruptDatabaseFile(path);
    const before = readFileSync(path);

    // Writable open of a corrupted file must never rebuild it silently.
    // (migrate: false keeps the open strictly read-then-query, so the file
    // bytes stay untouched and can be compared below.)
    await expect(
      openDatabase({ path, migrate: false }).then((opened) => {
        try {
          // Force a query that reads corrupted pages.
          opened.all("SELECT * FROM events");
        } finally {
          opened.close();
        }
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_corrupt;
    });

    // The corrupted bytes are untouched — diagnostics, never recreation.
    expect(Buffer.compare(readFileSync(path), before)).toBe(0);

    // Read-only diagnostic access still works for healthy pages.
    const diagnostic = await openDatabase({ path, readOnly: true });
    try {
      expect(diagnostic.get("SELECT name FROM sqlite_schema WHERE type='table' LIMIT 1")).toBeTruthy();
      try {
        diagnostic.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e2','ik2','p','t','stop',1,1,'internal','{}')");
        expect.unreachable("diagnostic mode must be read-only");
      } catch (err) {
        expect(isSestinaError(err) && err.code === SestinaErrorCode.database_readonly).toBe(true);
      }
    } finally {
      diagnostic.close();
    }
  });

  it("reports garbage files as corrupt without replacing them", async () => {
    const path = join(dir, "garbage.db");
    writeGarbageFile(path);
    const before = readFileSync(path, "utf8");

    expect(checkDatabaseIntegrity(path).ok).toBe(false);
    await expect(openDatabase({ path })).rejects.toSatisfy((err: unknown) => {
      return isSestinaError(err) && err.code === SestinaErrorCode.database_corrupt;
    });
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
