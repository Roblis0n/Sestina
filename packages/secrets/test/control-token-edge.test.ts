/* eslint-disable @typescript-eslint/require-await */
/**
 * Control token edge-case tests — RED tests for known failures.
 *
 * Each test reproduces a verified production bug BEFORE the fix.
 * After production code is fixed, these tests MUST all pass.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SecretBackend, SecretBackendStatus } from "../src/port.js";
import { SestinaError } from "@sestina/schema";
import {
  getOrCreateControlToken,
  resetControlToken,
  __test,
} from "../src/control-token.js";

function createFakeBackend(): SecretBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    async get(ref: string) { return store.get(ref); },
    async set(ref: string, value: string) { store.set(ref, value); },
    async delete(ref: string) { store.delete(ref); },
    async describe(ref: string) { return { configured: store.has(ref) }; },
    async health(): Promise<SecretBackendStatus> { return { available: true, backend: "dpapi" }; },
  };
}

describe("control token edge cases (RED→GREEN)", () => {
  let backend: ReturnType<typeof createFakeBackend>;

  beforeEach(() => { backend = createFakeBackend(); });

  // ── FAILURE 1: Legacy version exists but token missing → must throw, not rebuild ──
  describe("legacy version without token", () => {
    it("RED: throws SestinaError when version key exists but no token at ref", async () => {
      // Simulate legacy: version key exists but token key is empty/missing
      backend._store.set("sestina/control-token/ipc/version", "5");
      // ref key is deliberately absent

      await expect(getOrCreateControlToken(backend, "ipc"))
        .rejects.toThrow(SestinaError);
      await expect(getOrCreateControlToken(backend, "ipc"))
        .rejects.toThrow("version");
    });

    it("RED: corrupted legacy — version is '1junk' is rejected, not parsed as 1", async () => {
      // parseInt("1junk", 10) returns 1, which is wrong. Must validate whole string.
      const raw = __test.packRecord("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2", 1);
      // Replace the version number with "1junk" in the JSON
      const corrupted = raw.replace('"v":1', '"v":"1junk"');
      backend._store.set("sestina/control-token/ipc", corrupted);

      // Must throw — "1junk" is not a valid number
      await expect(getOrCreateControlToken(backend, "ipc"))
        .rejects.toThrow(SestinaError);
    });

    it("RED: corrupted legacy — version is 'notanumber' throws, not defaults to 1", async () => {
      const raw = __test.packRecord("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2", 1);
      const corrupted = raw.replace('"v":1', '"v":"notanumber"');
      backend._store.set("sestina/control-token/ipc", corrupted);

      await expect(getOrCreateControlToken(backend, "ipc"))
        .rejects.toThrow(SestinaError);
    });
  });

  // ── FAILURE 3: Reset overwrites corrupt record ──
  describe("reset on corrupt record", () => {
    it("RED: reset throws SestinaError when stored record is corrupt, does NOT overwrite", async () => {
      // Put corrupt garbage at the ref key
      backend._store.set("sestina/control-token/ipc", "THIS-IS-NOT-VALID-JSON-OR-HEX-!!!!");

      // Reset must throw, not silently overwrite
      await expect(resetControlToken(backend, "ipc"))
        .rejects.toThrow(SestinaError);

      // The corrupt record must still be there (not overwritten)
      expect(backend._store.get("sestina/control-token/ipc"))
        .toBe("THIS-IS-NOT-VALID-JSON-OR-HEX-!!!!");
    });
  });

  // ── FAILURE 4: Concurrent getOrCreate produces different tokens ──
  describe("concurrent getOrCreate atomicity", () => {
    it("RED: two concurrent calls return the SAME token", async () => {
      // Simulate race: both calls see empty store, both generate
      const [t1, t2] = await Promise.all([
        getOrCreateControlToken(backend, "ipc"),
        getOrCreateControlToken(backend, "ipc"),
      ]);
      // Must be identical — second call should see first call's result
      expect(t1.value).toBe(t2.value);
      expect(t1.version).toBe(1);
      expect(t2.version).toBe(1);
    });
  });
});
