import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openDatabase, type Migration, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("migration 016 Research Room", () => {
  let dir: string; let path: string; let db: StorageDatabase | undefined;
  beforeEach(() => { dir = makeTempDir(); path = join(dir, "sestina.db"); });
  afterEach(() => { db?.close(); removeTempDir(dir); });

  it("retains the migration-016 fail-closed receipt ledger in the current schema 18", async () => {
    db = await openDatabase({ path });
    expect(SCHEMA_VERSION).toBe(18);
    expect(db.get("SELECT name FROM sqlite_schema WHERE type='table' AND name='research_room_receipts'")).toBeTruthy();
    const sql = db.get<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE type='table' AND name='research_room_receipts'")?.sql ?? "";
    expect(sql).toContain("counts_as_external_evidence = 0");
    expect(sql).toContain("'rolled_back'");
    expect(db.get("SELECT name FROM sqlite_schema WHERE type='index' AND name='idx_research_room_receipts_project_review'")).toBeTruthy();
  });

  it("upgrades 015→016 without altering existing argument graph rows", async () => {
    db = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 15) } });
    const project = "rprj_01K0H000000000000000000001"; const artifact = "rart_01K0H000000000000000000001"; const revision = "rrev_01K0H000000000000000000001"; const claim = "rclm_01K0H000000000000000000001";
    db.run("INSERT INTO research_projects (project_id,title,root_path,version,created_at,updated_at,data) VALUES (?, 'keep', '.', 1, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z', '{}')", project);
    db.run("INSERT INTO research_artifacts (artifact_id,project_id,kind,title,version,active_revision_id,tombstoned,created_at,updated_at,data) VALUES (?,?,'research_note','keep',1,NULL,0,'2026-08-23T00:00:00.000Z','2026-08-23T00:00:00.000Z','{}')", artifact, project);
    db.run("INSERT INTO artifact_revisions (revision_id,project_id,artifact_id,parent_revision_id,content_hash,created_at,data) VALUES (?,?,?,NULL,?,'2026-08-23T00:00:00.000Z','{}')", revision, project, artifact, "0".repeat(64));
    db.run("INSERT INTO argument_claims (claim_id,project_id,artifact_id,revision_id,kind,version,created_at,data) VALUES (?,?,?,?,'assertion',1,'2026-08-23T00:00:00.000Z','{\"keep\":true}')", claim, project, artifact, revision);
    db.close(); db = await openDatabase({ path });
    expect(db.get<{ data: string }>("SELECT data FROM argument_claims WHERE claim_id=?", claim)?.data).toContain("keep");
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='research_room_receipts'")).toBeTruthy();
  });

  it("rolls back all migration-016 DDL when the migration fails", async () => {
    db = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 15) } }); db.close();
    const broken016: Migration = { version: 16, name: "016-broken", up(database) { database.exec("CREATE TABLE research_room_partial (value TEXT)"); database.exec("SELECT * FROM missing_research_room_source"); } };
    await expect(openDatabase({ path, migrate: { migrations: [...MIGRATIONS.slice(0, 15), broken016], backupDirectory: join(dir, "backups") } })).rejects.toBeTruthy();
    db = await openDatabase({ path, readOnly: true, migrate: false });
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='research_room_partial'")).toBeUndefined();
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='argument_claims'")).toBeTruthy();
  });
});
