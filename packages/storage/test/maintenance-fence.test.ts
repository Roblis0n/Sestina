import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import {
  openDatabase,
  MaintenanceFence,
  restoreDatabase,
  backupDatabase,
} from "../src/index.js";
import { isSestinaError, SestinaErrorCode } from "@sestina/schema";
import { makeTempDir, removeTempDir, spawnChildScenario } from "./helpers.js";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("MaintenanceFence (common maintenance domain, docs/17 §3.2, docs/22 Task 6)", () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  it("acquires, renews and releases", async () => {
    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations" });
    expect(MaintenanceFence.peek(dir)?.token).toBe(fence.token);
    fence.renew(120_000);
    const peeked = MaintenanceFence.peek(dir);
    expect(peeked?.token).toBe(fence.token);
    expect((peeked?.expiresAt ?? 0)).toBeGreaterThan(Date.now());
    fence.release();
    expect(MaintenanceFence.peek(dir)).toBeUndefined();
  });

  it("excludes any maintenance scope while held (one global domain)", async () => {
    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations" });
    try {
      await expect(
        MaintenanceFence.acquire({ dataRoot: dir, scope: "restore" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
      await expect(
        MaintenanceFence.acquire({ dataRoot: dir, scope: "retention" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      fence.release();
    }
  });

  it("takes over an expired fence and fences out the stale holder (ABA)", async () => {
    const first = await MaintenanceFence.acquire({ dataRoot: dir, scope: "restore", ttlMs: 250 });
    await delay(400);
    const second = await MaintenanceFence.acquire({ dataRoot: dir, scope: "restore", ttlMs: 60_000 });

    try {
      first.renew(60_000);
      expect.unreachable("stale renew must throw stale_state");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.stale_state);
      }
    }
    first.release(); // no-op: must not delete the new holder's fence
    expect(MaintenanceFence.peek(dir)?.token).toBe(second.token);
    second.release();
    expect(MaintenanceFence.peek(dir)).toBeUndefined();
  });

  it("takes over a corrupted sentinel file", async () => {
    writeFileSync(join(dir, ".sestina-maintenance.lock"), "{ not valid json", "utf8");
    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations" });
    expect(MaintenanceFence.peek(dir)?.token).toBe(fence.token);
    fence.release();
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    "rejects invalid fence ttlMs=%s",
    async (ttlMs) => {
      await expect(
        MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations", ttlMs }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.validation_failed;
      });
    },
  );

  it("throws stale_state when renewing after release", async () => {
    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations" });
    fence.release();
    try {
      fence.renew(60_000);
      expect.unreachable("renew after release must throw stale_state");
    } catch (err) {
      expect(isSestinaError(err)).toBe(true);
      if (isSestinaError(err)) {
        expect(err.code).toBe(SestinaErrorCode.stale_state);
      }
    }
  });

  it("excludes a second process while held (real child process)", async () => {
    const child = spawnChildScenario({
      scenario: "hold-fence",
      env: { SESTINA_CHILD_ROOT: dir, SESTINA_CHILD_SCOPE: "migrations", SESTINA_CHILD_TTL: "60000", SESTINA_CHILD_HOLD_MS: "5000" },
    });
    try {
      expect(await child.waitForReady()).toBe(true);
      await expect(
        MaintenanceFence.acquire({ dataRoot: dir, scope: "restore" }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      expect(await child.wait()).toBe(0);
    }
    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "restore" });
    fence.release();
  }, 60000);

  it("survives a stale cross-process release (crashed holder ABA)", async () => {
    const tokenFile = join(dir, "token.txt");
    const child = spawnChildScenario({
      scenario: "acquire-fence-short",
      env: { SESTINA_CHILD_ROOT: dir, SESTINA_CHILD_TTL: "250", SESTINA_CHILD_TOKEN_FILE: tokenFile },
    });
    expect(await child.waitForReady()).toBe(true);
    expect(await child.wait()).toBe(0);
    await delay(400); // let the child's fence expire

    const parent = await MaintenanceFence.acquire({ dataRoot: dir, scope: "restore", ttlMs: 60_000 });
    const oldToken = readFileSync(tokenFile, "utf8").trim();
    expect(oldToken).not.toBe(parent.token);

    // The dead holder tries to release with its stale token.
    const staleChild = spawnChildScenario({
      scenario: "stale-release-fence",
      env: { SESTINA_CHILD_ROOT: dir, SESTINA_CHILD_TOKEN: oldToken },
    });
    expect(await staleChild.wait()).toBe(0);

    expect(MaintenanceFence.peek(dir)?.token).toBe(parent.token);
    parent.release();
  }, 60000);

  it("blocks migrations while the fence is held", async () => {
    const dbPath = join(dir, "sestina.db");
    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations" });
    try {
      await expect(openDatabase({ path: dbPath, dataRoot: dir })).rejects.toSatisfy(
        (err: unknown) => isSestinaError(err) && err.code === SestinaErrorCode.storage_busy,
      );
    } finally {
      fence.release();
    }
    // After release the same open succeeds.
    const db = await openDatabase({ path: dbPath, dataRoot: dir });
    db.close();
  });

  it("blocks restore while the fence is held (migration and restore share one domain)", async () => {
    const dbPath = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const seed = await openDatabase({ path: dbPath, dataRoot: dir });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','fk1','p','t','stop',1,1,'internal','{}')");
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.close();

    const fence = await MaintenanceFence.acquire({ dataRoot: dir, scope: "migrations" });
    try {
      await expect(
        restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.storage_busy;
      });
    } finally {
      fence.release();
    }
    // After release the restore succeeds and leaves the fence released.
    const result = await restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir });
    expect(result.restoredFrom).toBe(backup.path);
    expect(MaintenanceFence.peek(dir)).toBeUndefined();
  });

  it("holds the fence across the whole restore (fence exists while restoring)", async () => {
    const dbPath = join(dir, "sestina.db");
    const backupDir = join(dir, "backups");
    const seed = await openDatabase({ path: dbPath, dataRoot: dir });
    seed.run("INSERT INTO events (event_id, idempotency_key, project_id, task_id, event_type, occurred_at, received_at, privacy_class, data) VALUES ('e1','gk1','p','t','stop',1,1,'internal','{}')");
    const backup = await backupDatabase(seed, { backupDirectory: backupDir });
    seed.close();

    const sawFence = { value: false };
    const restorePromise = restoreDatabase({ databasePath: dbPath, backupPath: backup.path, dataRoot: dir });
    const pollPromise = (async () => {
      for (let i = 0; i < 200; i++) {
        if (sawFence.value) break;
        if (MaintenanceFence.peek(dir) !== undefined) {
          sawFence.value = true;
          break;
        }
        await delay(10);
      }
    })();
    await Promise.all([restorePromise, pollPromise]);
    expect(sawFence.value).toBe(true);
    expect(MaintenanceFence.peek(dir)).toBeUndefined();
  });
});
