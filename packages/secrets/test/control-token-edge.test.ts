/* eslint-disable @typescript-eslint/require-await */
/**
 * Control token edge-case tests — RED tests for known failures.
 *
 * Each test reproduces a verified production bug BEFORE the fix.
 * After production code is fixed, these tests MUST all pass.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SecretBackend, SecretBackendStatus } from "../src/port.js";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import {
  getOrCreateControlToken,
  resetControlToken,
  __test,
} from "../src/control-token.js";

function createFakeBackend(): SecretBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    async get(ref: string) {
      return store.get(ref);
    },
    async set(ref: string, value: string) {
      store.set(ref, value);
    },
    async delete(ref: string) {
      store.delete(ref);
    },
    async describe(ref: string) {
      return { configured: store.has(ref) };
    },
    async health(): Promise<SecretBackendStatus> {
      return { available: true, backend: "dpapi" };
    },
  };
}

function createRacingBackend(): SecretBackend & {
  _store: Map<string, string>;
} {
  const store = new Map<string, string>();
  let setCalls = 0;
  return {
    _store: store,
    async get(ref: string) {
      return store.get(ref);
    },
    async set(ref: string, value: string) {
      setCalls++;
      if (setCalls === 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      store.set(ref, value);
    },
    async delete(ref: string) {
      store.delete(ref);
    },
    async describe(ref: string) {
      return { configured: store.has(ref) };
    },
    async health(): Promise<SecretBackendStatus> {
      return { available: true, backend: "dpapi" };
    },
  };
}

describe("control token edge cases (RED→GREEN)", () => {
  let backend: ReturnType<typeof createFakeBackend>;

  beforeEach(() => {
    backend = createFakeBackend();
  });

  // ── FAILURE 1: Legacy version exists but token missing → must throw, not rebuild ──
  describe("legacy version without token", () => {
    it("RED: throws SestinaError when version key exists but no token at ref", async () => {
      // Simulate legacy: version key exists but token key is empty/missing
      backend._store.set("sestina/control-token/ipc/version", "5");
      // ref key is deliberately absent

      await expect(getOrCreateControlToken(backend, "ipc")).rejects.toThrow(
        SestinaError,
      );
      await expect(getOrCreateControlToken(backend, "ipc")).rejects.toThrow(
        "version",
      );
    });

    it("RED: corrupted legacy — version is '1junk' is rejected, not parsed as 1", async () => {
      // parseInt("1junk", 10) returns 1, which is wrong. Must validate whole string.
      const raw = __test.packRecord(
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        1,
      );
      // Replace the version number with "1junk" in the JSON
      const corrupted = raw.replace('"v":1', '"v":"1junk"');
      backend._store.set("sestina/control-token/ipc", corrupted);

      // Must throw — "1junk" is not a valid number
      await expect(getOrCreateControlToken(backend, "ipc")).rejects.toThrow(
        SestinaError,
      );
    });

    it("RED: corrupted legacy — version is 'notanumber' throws, not defaults to 1", async () => {
      const raw = __test.packRecord(
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        1,
      );
      const corrupted = raw.replace('"v":1', '"v":"notanumber"');
      backend._store.set("sestina/control-token/ipc", corrupted);

      await expect(getOrCreateControlToken(backend, "ipc")).rejects.toThrow(
        SestinaError,
      );
    });

    it("rejects a malformed split-storage version without overwriting the legacy token", async () => {
      const token = "a".repeat(64);
      backend._store.set("sestina/control-token/ipc", token);
      backend._store.set("sestina/control-token/ipc/version", "1junk");

      await expect(
        getOrCreateControlToken(backend, "ipc"),
      ).rejects.toMatchObject({ code: SestinaErrorCode.database_corrupt });
      expect(backend._store.get("sestina/control-token/ipc")).toBe(token);
      expect(backend._store.get("sestina/control-token/ipc/version")).toBe(
        "1junk",
      );
    });

    it("migrates a valid split-storage token and preserves its version", async () => {
      const token = "b".repeat(64);
      backend._store.set("sestina/control-token/ipc", token);
      backend._store.set("sestina/control-token/ipc/version", "7");

      const migrated = await getOrCreateControlToken(backend, "ipc");

      expect(migrated).toEqual({
        ref: "sestina/control-token/ipc",
        version: 7,
        value: token,
      });
      expect(
        backend._store.get("sestina/control-token/ipc/version"),
      ).toBeUndefined();
      expect(
        JSON.parse(backend._store.get("sestina/control-token/ipc") ?? "null"),
      ).toEqual({ v: 7, t: token });
    });
  });

  // ── FAILURE 3: Reset overwrites corrupt record ──
  describe("reset on corrupt record", () => {
    it("RED: reset throws SestinaError when stored record is corrupt, does NOT overwrite", async () => {
      // Put corrupt garbage at the ref key
      backend._store.set(
        "sestina/control-token/ipc",
        "THIS-IS-NOT-VALID-JSON-OR-HEX-!!!!",
      );

      // Reset must throw, not silently overwrite
      await expect(resetControlToken(backend, "ipc")).rejects.toThrow(
        SestinaError,
      );

      // The corrupt record must still be there (not overwritten)
      expect(backend._store.get("sestina/control-token/ipc")).toBe(
        "THIS-IS-NOT-VALID-JSON-OR-HEX-!!!!",
      );
    });
  });

  // ── FAILURE 4: Concurrent getOrCreate produces different tokens ──
  describe("concurrent getOrCreate atomicity", () => {
    it("RED: two concurrent calls return the SAME token", async () => {
      const racingBackend = createRacingBackend();
      const [t1, t2] = await Promise.all([
        getOrCreateControlToken(racingBackend, "ipc"),
        getOrCreateControlToken(racingBackend, "ipc"),
      ]);
      // Must be identical — second call should see first call's result
      expect(t1.value).toBe(t2.value);
      expect(t1.version).toBe(1);
      expect(t2.version).toBe(1);
    });

    it("releases the scope lock after a failed write", async () => {
      let fail = true;
      const store = new Map<string, string>();
      const flaky: SecretBackend = {
        async get(ref: string) {
          return store.get(ref);
        },
        async set(ref: string, value: string) {
          if (fail) {
            fail = false;
            throw new SestinaError(
              SestinaErrorCode.secure_storage_unavailable,
              "synthetic write failure",
            );
          }
          store.set(ref, value);
        },
        async delete(ref: string) {
          store.delete(ref);
        },
        async describe(ref: string) {
          return { configured: store.has(ref) };
        },
        async health() {
          return { available: true, backend: "dpapi" };
        },
      };

      await expect(getOrCreateControlToken(flaky, "ipc")).rejects.toMatchObject(
        { code: SestinaErrorCode.secure_storage_unavailable },
      );
      await expect(
        getOrCreateControlToken(flaky, "ipc"),
      ).resolves.toMatchObject({ version: 1 });
    });
  });

  describe("reset validation", () => {
    it("increments the validated legacy version when resetting a legacy token", async () => {
      backend._store.set("sestina/control-token/ipc", "c".repeat(64));
      backend._store.set("sestina/control-token/ipc/version", "9");

      const reset = await resetControlToken(backend, "ipc");

      expect(reset.version).toBe(10);
      expect(
        backend._store.get("sestina/control-token/ipc/version"),
      ).toBeUndefined();
    });

    it("uses a stable SestinaError when the version cannot be incremented", async () => {
      backend._store.set(
        "sestina/control-token/ipc",
        __test.packRecord("d".repeat(64), __test.MAX_VERSION),
      );

      await expect(resetControlToken(backend, "ipc")).rejects.toMatchObject({
        code: SestinaErrorCode.limit_exceeded,
      });
    });
  });
});
