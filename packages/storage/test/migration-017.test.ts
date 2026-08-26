import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openDatabase, type Migration, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("migration 017 correction appeals", () => {
  let dir: string;
  let path: string;
  let db: StorageDatabase | undefined;

  beforeEach(() => {
    dir = makeTempDir();
    path = join(dir, "sestina.db");
  });

  afterEach(() => {
    db?.close();
    removeTempDir(dir);
  });

  it("creates a strict project-bound appeal ledger with one unresolved appeal per Finding", async () => {
    db = await openDatabase({ path });
    expect(SCHEMA_VERSION).toBe(17);
    const sql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type='table' AND name='correction_appeals'")?.sql ?? "";
    expect(sql.trim().toUpperCase().endsWith("STRICT")).toBe(true);
    expect(sql).toContain("CHECK (status IN ('draft','recorded','awaiting_send_confirmation','second_opinion_running','second_opinion_ready','appeal_record_only','waiting_user_resolution','provider_failed','cancelled','stale_conflicted','resolved'))");
    expect(sql).not.toContain("raw_response");
    expect(sql).not.toContain("secret");
    const activeIndex = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type='index' AND name='idx_correction_appeals_one_active_finding'")?.sql ?? "";
    expect(activeIndex).toContain("UNIQUE INDEX");
    expect(activeIndex).toContain("WHERE status <> 'resolved'");
    expect(db.get("SELECT name FROM sqlite_schema WHERE type='index' AND name='idx_correction_appeals_project_updated'")).toBeTruthy();
  });

  it("upgrades 016 to 017 without altering an existing Research Room receipt", async () => {
    db = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 16) } });
    const project = "rprj_01K0H000000000000000000001";
    const receipt = "rrcp_01K0H000000000000000000001";
    db.run("INSERT INTO research_projects (project_id,title,root_path,version,created_at,updated_at,data) VALUES (?, 'keep', '.', 1, '2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z', '{}')", project);
    db.run("INSERT INTO research_room_receipts (receipt_id,project_id,review_id,source_episode_id,status,disposition,provider_status,evidence_class,counts_as_external_evidence,version,receipt_hash,created_at,updated_at,data) VALUES (?,?,?,NULL,'committed','rejected','semantic_ready','synthetic_fixture',0,1,?,'2026-08-26T00:00:00.000Z','2026-08-26T00:00:00.000Z','{\"keep\":true}')", receipt, project, "rrvw_01K0H000000000000000000001", "a".repeat(64));
    db.close();
    db = await openDatabase({ path });
    expect(db.get<{ data: string }>("SELECT data FROM research_room_receipts WHERE receipt_id=?", receipt)?.data).toContain("keep");
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='correction_appeals'")).toBeTruthy();
  });

  it("rolls back all migration-017 DDL on failure", async () => {
    db = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 16) } });
    db.close();
    const broken017: Migration = {
      version: 17,
      name: "017-broken",
      up(database) {
        database.exec("CREATE TABLE correction_appeals_partial (value TEXT)");
        database.exec("SELECT * FROM missing_appeal_source");
      },
    };
    await expect(openDatabase({ path, migrate: { migrations: [...MIGRATIONS.slice(0, 16), broken017], backupDirectory: join(dir, "backups") } })).rejects.toBeTruthy();
    db = await openDatabase({ path, readOnly: true, migrate: false });
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='correction_appeals_partial'")).toBeUndefined();
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='research_room_receipts'")).toBeTruthy();
  });
});
