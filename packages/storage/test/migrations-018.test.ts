import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openDatabase, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("Migration 018 (bounded deliberation rooms)", () => {
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

  it("retains migration 018's strict project-scoped room table and active-source index in schema 20", () => {
    expect(SCHEMA_VERSION).toBe(20);
    expect(MIGRATIONS.find((migration) => migration.version === 18)).toMatchObject({ version: 18, name: "018-deliberation-rooms" });
    expect(db.get<{ status: string }>("SELECT status FROM migrations WHERE version = 18")?.status).toBe("completed");
    const sql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'deliberation_rooms'")?.sql ?? "";
    expect(sql).toContain("STRICT");
    expect(sql).toContain("'retry_prepared','retry_running'");
    const indexes = db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'deliberation_rooms'").map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_deliberation_rooms_one_active_source", "idx_deliberation_rooms_project_updated", "idx_deliberation_rooms_project_status"]));
  });
});
