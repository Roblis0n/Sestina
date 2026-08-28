import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openDatabase, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("Migration 019 (project working memory and resume continuity)", () => {
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

  it("retains schema 19's strict project-scoped memory and checkpoint tables in schema 20 while keeping request Manifests transient", () => {
    expect(SCHEMA_VERSION).toBe(20);
    expect(MIGRATIONS.find((migration) => migration.version === 19)).toMatchObject({ version: 19, name: "019-project-working-memory" });
    expect(db.get<{ status: string }>("SELECT status FROM migrations WHERE version = 19")?.status).toBe("completed");
    for (const table of ["project_working_memory", "resume_checkpoints"]) {
      const sql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?", table)?.sql ?? "";
      expect(sql).toContain("STRICT");
      expect(sql).toContain("project_id");
    }
    const itemSql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'project_working_memory'")?.sql ?? "";
    expect(itemSql).toContain("'candidate','active','stale','expired','retired','forgotten'");
    expect(itemSql).toContain("'never_send','explicit_manifest_only'");
    expect(itemSql).not.toContain("always_send");
    expect(db.get("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'project_memory_manifests'")).toBeUndefined();
    const indexes = db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name IN ('project_working_memory','resume_checkpoints')").map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining([
      "idx_project_working_memory_project_updated",
      "idx_project_working_memory_project_state_expiry",
      "idx_resume_checkpoints_project_reviewed",
    ]));
  });

  it("upgrades a schema-18 database once and preserves existing project data", async () => {
    db.close();
    const path = join(dir, "upgrade.db");
    const prior = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 18) } });
    prior.run(
      "INSERT INTO research_projects (project_id, title, root_path, version, created_at, updated_at, data) VALUES (?, 'before-019', '.', 1, ?, ?, ?)",
      "rprj_00000000000000000000000001",
      "2026-08-27T00:00:00.000Z",
      "2026-08-27T00:00:00.000Z",
      JSON.stringify({ preserved: true }),
    );
    prior.close();
    const upgraded = await openDatabase({ path });
    try {
      expect(upgraded.get<{ title: string }>("SELECT title FROM research_projects WHERE project_id = ?", "rprj_00000000000000000000000001")?.title).toBe("before-019");
      expect(upgraded.get<{ status: string }>("SELECT status FROM migrations WHERE version = 19")?.status).toBe("completed");
    } finally {
      upgraded.close();
    }
  });
});
