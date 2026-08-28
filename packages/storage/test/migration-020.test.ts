import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openDatabase, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("Migration 020 (closed external app pilots)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("adds immutable schema 20 with project-bound Pilot, attempt, and append-only event tables", () => {
    expect(SCHEMA_VERSION).toBe(20);
    expect(MIGRATIONS.at(-1)).toMatchObject({ version: 20, name: "020-closed-external-app-pilots" });
    for (const name of ["closed_external_app_pilots", "closed_external_app_pilot_attempts", "closed_external_app_pilot_events"]) {
      const sql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?", name)?.sql ?? "";
      expect(sql).toContain("STRICT");
      expect(sql).toContain("project_id");
    }
    const pilotSql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'closed_external_app_pilots'")?.sql ?? "";
    expect(pilotSql).toContain("interrupted_unknown");
    expect(pilotSql).toContain("host IN ('codex')");
    expect(db.get<{ status: string }>("SELECT status FROM migrations WHERE version = 20")?.status).toBe("completed");
  });
});
