import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { MIGRATIONS, openDatabase, readSchemaVersion, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("Migration 014 (review runs)", () => {
  let dir: string;
  let db: StorageDatabase;
  beforeEach(async () => {
    dir = makeTempDir("sestina-review-014-");
    db = await openDatabase({ path: join(dir, "sestina.db"), migrate: { migrations: MIGRATIONS.slice(0, 14) } });
  });
  afterEach(() => { db.close(); removeTempDir(dir); });

  it("advances only to the two RI-18 review tables", () => {
    expect(readSchemaVersion(db)).toBe(14);
    expect(MIGRATIONS[13]?.name).toBe("014-review-runs");
    for (const table of ["review_runs", "review_findings"]) {
      const sql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?", table)?.sql ?? "";
      expect(sql.trim().toUpperCase().endsWith("STRICT"), table).toBe(true);
    }
    expect(db.get("SELECT name FROM sqlite_schema WHERE name = 'argument_deltas'")).toBeUndefined();
    expect(db.get("SELECT name FROM sqlite_schema WHERE name = 'research_claims'")).toBeUndefined();
  });
});
