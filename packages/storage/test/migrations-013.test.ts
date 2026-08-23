import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  hashFile,
  migration013,
  MIGRATIONS,
  SCHEMA_VERSION,
  openDatabase,
  type Migration,
  type StorageDatabase,
} from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

const RESEARCH_TABLES = [
  "research_projects",
  "research_artifacts",
  "artifact_revisions",
  "research_briefs",
  "research_decisions",
  "research_decision_transitions",
  "research_issues",
  "research_issue_transitions",
  "revision_episodes",
  "research_snapshots",
] as const;

describe("Migration 013 (research core persistence)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir("sestina-research-013-");
    db = await openDatabase({ path: join(dir, "sestina.db"), migrate: { migrations: MIGRATIONS.slice(0, 13) } });
  });

  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("advances the schema to 13 and creates only the RI-16 research tables", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
    expect(MIGRATIONS[12]?.name).toBe("013-research-core");
    const tables = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .map((row) => row.name),
    );
    for (const table of RESEARCH_TABLES) expect(tables.has(table)).toBe(true);
    expect(tables.has("review_runs")).toBe(false);
    expect(tables.has("research_findings")).toBe(false);
    expect(tables.has("argument_deltas")).toBe(false);
  });

  it("creates every research table as STRICT", () => {
    for (const table of RESEARCH_TABLES) {
      const sql = db.get<{ sql: string }>(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
        table,
      )?.sql ?? "";
      expect(sql.trim().toUpperCase().endsWith("STRICT"), table).toBe(true);
    }
  });

  it("upgrades a real version 12 database, preserves legacy rows, and records a hashed backup", async () => {
    const legacyPath = join(dir, "legacy-v12.db");
    const v12 = await openDatabase({
      path: legacyPath,
      migrate: { migrations: MIGRATIONS.slice(0, 12) },
    });
    v12.run(
      "INSERT INTO projects (project_id, display_name, created_at, data) VALUES ('legacy-project', 'legacy', 1, '{}')",
    );
    v12.close();

    const upgraded = await openDatabase({ path: legacyPath, migrate: { migrations: MIGRATIONS.slice(0, 13) } });
    try {
      expect(upgraded.get("SELECT project_id FROM projects WHERE project_id = 'legacy-project'"))
        .toBeTruthy();
      const journal = upgraded.get<{ status: string; backup_path: string; backup_hash: string }>(
        "SELECT status, backup_path, backup_hash FROM migrations WHERE version = 13",
      );
      expect(journal?.status).toBe("completed");
      expect(existsSync(journal?.backup_path ?? "")).toBe(true);
      expect(await hashFile(journal?.backup_path ?? "")).toBe(journal?.backup_hash);
    } finally {
      upgraded.close();
    }
  });

  it("does not reapply a completed migration 013", async () => {
    const path = join(dir, "idempotent-013.db");
    const first = await openDatabase({ path });
    const startedAt = first.get<{ started_at: number }>(
      "SELECT started_at FROM migrations WHERE version = 13",
    )?.started_at;
    first.close();
    const reopened = await openDatabase({ path });
    try {
      expect(reopened.get<{ started_at: number }>(
        "SELECT started_at FROM migrations WHERE version = 13",
      )?.started_at).toBe(startedAt);
      expect(reopened.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM migrations WHERE version = 13",
      )?.count).toBe(1);
    } finally {
      reopened.close();
    }
  });

  it("rolls back a failed 013, records failure, and safely retries after repair", async () => {
    const path = join(dir, "retry-013.db");
    const v12 = await openDatabase({
      path,
      migrate: { migrations: MIGRATIONS.slice(0, 12) },
    });
    v12.close();
    const failing: Migration = {
      ...migration013,
      up(database) {
        migration013.up(database);
        throw new Error("controlled migration failure");
      },
    };
    await expect(openDatabase({
      path,
      migrate: { migrations: [...MIGRATIONS.slice(0, 12), failing] },
    })).rejects.toMatchObject({ code: "migration_failed" });

    const diagnostics = await openDatabase({ path, readOnly: true, migrate: false });
    try {
      expect(diagnostics.get<{ status: string }>(
        "SELECT status FROM migrations WHERE version = 13",
      )?.status).toBe("failed");
      expect(diagnostics.get(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'research_projects'",
      )).toBeUndefined();
    } finally {
      diagnostics.close();
    }

    const repaired = await openDatabase({ path });
    try {
      expect(repaired.get<{ status: string }>(
        "SELECT status FROM migrations WHERE version = 13",
      )?.status).toBe("completed");
      expect(repaired.get(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'research_projects'",
      )).toBeTruthy();
    } finally {
      repaired.close();
    }
  });
});
