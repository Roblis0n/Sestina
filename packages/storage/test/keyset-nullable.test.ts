import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { openDatabase, createTransactionView, keysetPage } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

// keysetPage must page correctly when the key column is NULL-able: NULLs
// sort first in SQLite ASC order, and a boundary row whose key is NULL must
// produce a cursor that continues INSIDE the NULL group instead of encoding
// Number(null) === 0 and silently skipping the remaining NULL-key rows
// (docs/22 Task 6 fix).
describe("keysetPage with a nullable key column", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    db.exec(
      "CREATE TABLE nullable_keys (id TEXT PRIMARY KEY, sort_key INTEGER, data TEXT NOT NULL) STRICT",
    );
    const rows: [string, number | null][] = [
      ["null-1", null],
      ["null-2", null],
      ["null-3", null],
      ["key-1", 100],
      ["key-2", 200],
      ["key-3", 300],
    ];
    for (const [id, key] of rows) {
      db.run("INSERT INTO nullable_keys (id, sort_key, data) VALUES (?, ?, 'x')", id, key);
    }
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("pages through NULL keys without skipping rows", () => {
    const tx = createTransactionView(db);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNum = 0; pageNum < 10; pageNum++) {
      const page = keysetPage<{ id: string; sort_key: number | null }>(tx, {
        table: "nullable_keys",
        columns: "id, sort_key",
        keyColumn: "sort_key",
        idColumn: "id",
        cursor,
        limit: 2,
      });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("keeps NULL-key rows ahead of non-NULL keys across page boundaries", () => {
    const tx = createTransactionView(db);
    const page1 = keysetPage<{ id: string; sort_key: number | null }>(tx, {
      table: "nullable_keys",
      columns: "id, sort_key",
      keyColumn: "sort_key",
      idColumn: "id",
      limit: 2,
    });
    expect(page1.items.map((r) => r.id)).toEqual(["null-1", "null-2"]);
    expect(page1.nextCursor).toBeDefined();
    const page2 = keysetPage<{ id: string; sort_key: number | null }>(tx, {
      table: "nullable_keys",
      columns: "id, sort_key",
      keyColumn: "sort_key",
      idColumn: "id",
      cursor: page1.nextCursor,
      limit: 10,
    });
    expect(page2.items.map((r) => r.id)).toEqual(["null-3", "key-1", "key-2", "key-3"]);
    expect(page2.nextCursor).toBeUndefined();
  });
});
