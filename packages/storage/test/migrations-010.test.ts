import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  openDatabase,
  MIGRATIONS,
  type StorageDatabase,
} from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

/**
 * Structural tests for migration 010 (docs/22 Task 8 review hardening):
 * the project-scoped session keyset page and the active-binding
 * fingerprint lookup must be index-served — no temp b-tree sorts and no
 * full scans on the hot paths added by Task 8.
 */
describe("Migration 010 (lookup indexes)", () => {
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

  it("records version 10 as completed", () => {
    const row = db.get<{ name: string; status: string }>(
      "SELECT name, status FROM migrations WHERE version = 10",
    );
    expect(row?.name).toBe("010-lookup-indexes");
    expect(row?.status).toBe("completed");
    expect(MIGRATIONS.at(-1)?.version).toBe(13);
  });

  it("serves the project session keyset page from an index without a temp b-tree", () => {
    // The keyset shape of sessions.listByProject (first page, no cursor).
    const plan = db
      .all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT session_id FROM host_sessions
         WHERE project_id = 'p10' ORDER BY started_at, session_id LIMIT 10`,
      )
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("idx_host_sessions_project_started");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("serves the active binding fingerprint lookup from a partial index", () => {
    const plan = db
      .all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT project_id FROM project_root_bindings
         WHERE fingerprint = 'fp10' AND status = 'active' ORDER BY project_id`,
      )
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("idx_project_root_bindings_fingerprint_active");
    expect(plan).not.toContain("SCAN project_root_bindings");
  });

  it("upgrades a v9 database in place and keeps sessions and bindings", async () => {
    const legacyPath = join(dir, "legacy-010.db");
    const v9 = await openDatabase({
      path: legacyPath,
      migrate: { migrations: MIGRATIONS.slice(0, 9) },
    });
    v9.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES ('p10', 'p10', 0, '{}')",
    );
    v9.run(
      `INSERT INTO host_sessions (session_id, project_id, task_id, host, host_session_id, status, started_at, data)
       VALUES ('s10', 'p10', NULL, 'codex', 'hs-10', 'connected', 1000000, ?)`,
      JSON.stringify({ visibilityLevel: "tool_lifecycle" }),
    );
    v9.run(
      `INSERT INTO project_root_bindings (project_id, root_path, status, created_at, fingerprint, confirmed, source, case_semantics, data)
       VALUES ('p10', '/work/root', 'active', 0, 'fp-10', 1, 'user_added', 'case_insensitive', ?)`,
      JSON.stringify({ fingerprint: "fp-10" }),
    );
    v9.close();

    const upgraded = await openDatabase({ path: legacyPath });
    try {
      const session = upgraded.get<{ session_id: string }>(
        "SELECT session_id FROM host_sessions WHERE session_id = 's10'",
      );
      expect(session?.session_id).toBe("s10");
      const binding = upgraded.get<{ fingerprint: string }>(
        "SELECT fingerprint FROM project_root_bindings WHERE project_id = 'p10'",
      );
      expect(binding?.fingerprint).toBe("fp-10");
      const indexes = new Set(
        upgraded
          .all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'index'")
          .map((row) => row.name),
      );
      expect(indexes.has("idx_host_sessions_project_started")).toBe(true);
      expect(indexes.has("idx_project_root_bindings_fingerprint_active")).toBe(true);
    } finally {
      upgraded.close();
    }
  });
});
