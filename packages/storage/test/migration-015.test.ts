import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openDatabase, type Migration, type StorageDatabase } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("migration 015 Argument Graph", () => {
  let dir: string; let path: string; let db: StorageDatabase | undefined;
  beforeEach(() => { dir = makeTempDir(); path = join(dir, "sestina.db"); });
  afterEach(() => { db?.close(); removeTempDir(dir); });

  it("advances a fresh database to schema 15 with only the six current graph tables", async () => {
    db = await openDatabase({ path });
    expect(SCHEMA_VERSION).toBe(15);
    const tables = new Set(db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table'").map((row) => row.name));
    for (const name of ["argument_claims", "argument_evidence", "argument_mechanism_links", "argument_claim_evidence_links", "argument_mechanism_evidence_links", "argument_deltas"]) expect(tables.has(name)).toBe(true);
  });

  it("upgrades 014→015 without touching legacy assertion/evidence rows", async () => {
    db = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 14) } });
    db.run("INSERT INTO situation_assertions (assertion_id, project_id, task_id, status, valid_from, valid_until, data) VALUES ('a15','p','t','unconfirmed',1,NULL,'{\"statement\":\"keep\"}')");
    db.close(); db = await openDatabase({ path });
    expect(db.get<{ data: string }>("SELECT data FROM situation_assertions WHERE assertion_id='a15'")?.data).toContain("keep");
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='argument_claims'")).toBeTruthy();
  });

  it("rolls back all migration-015 DDL when the migration fails", async () => {
    db = await openDatabase({ path, migrate: { migrations: MIGRATIONS.slice(0, 14) } }); db.close();
    const broken015: Migration = { version: 15, name: "015-broken", up(database) { database.exec("CREATE TABLE argument_partial (value TEXT)"); database.exec("SELECT * FROM missing_argument_source"); } };
    await expect(openDatabase({ path, migrate: { migrations: [...MIGRATIONS.slice(0, 14), broken015], backupDirectory: join(dir, "backups") } })).rejects.toBeTruthy();
    db = await openDatabase({ path, readOnly: true, migrate: false });
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='argument_partial'")).toBeUndefined();
    expect(db.get("SELECT name FROM sqlite_schema WHERE name='review_runs'")).toBeTruthy();
  });
});
