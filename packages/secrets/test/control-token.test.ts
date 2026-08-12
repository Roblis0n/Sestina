/* eslint-disable @typescript-eslint/require-await */
/**
 * Control token tests — generation, versioning, rotation, isolation.
 *
 * These tests use a fake SecretBackend (in-memory Map) injected into the
 * REAL production control-token functions from src/control-token.ts.
 * No inline reimplementation of token logic — dependency injection only.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SecretBackend, SecretBackendStatus } from "../src/port.js";

// ── Fake in-memory backend for testing (DI pattern) ──

function createFakeBackend(): SecretBackend {
  const store = new Map<string, string>();
  return {
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

// ── Import REAL production code ──

import {
  getOrCreateControlToken,
  resetControlToken,
  verifyChallengeResponse,
  __test,
} from "../src/control-token.js";

// ── Tests ──

describe("control token", () => {
  let backend: SecretBackend;

  beforeEach(() => {
    backend = createFakeBackend();
  });

  describe("getOrCreateControlToken", () => {
    it("generates a 256-bit (64 hex char) token on first call", async () => {
      const token = await getOrCreateControlToken(backend, "ipc");
      expect(token.value).toHaveLength(__test.TOKEN_HEX_LENGTH);
      expect(token.version).toBe(1);
      // Verify it's hex
      expect(/^[0-9a-f]{64}$/.test(token.value)).toBe(true);
    });

    it("returns the same token on subsequent calls (no rotation)", async () => {
      const first = await getOrCreateControlToken(backend, "ipc");
      const second = await getOrCreateControlToken(backend, "ipc");
      expect(second.value).toBe(first.value);
      expect(second.version).toBe(first.version);
    });

    it("preserves token across process restarts (stored in backend)", async () => {
      const first = await getOrCreateControlToken(backend, "ipc");
      // Same backend instance simulates persisted storage
      const second = await getOrCreateControlToken(backend, "ipc");
      expect(second.value).toBe(first.value);
    });

    it("produces random tokens (collision resistance)", async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 10; i++) {
        // Create new backend each time to force new generation
        const fresh = createFakeBackend();
        const t = await getOrCreateControlToken(fresh, `ipc-${i}`);
        tokens.add(t.value);
      }
      // All 10 tokens should be unique
      expect(tokens.size).toBe(10);
    });

    it("isolates tokens by scope", async () => {
      const ipc = await getOrCreateControlToken(backend, "ipc");
      const challenge = await getOrCreateControlToken(backend, "challenge");
      expect(ipc.value).not.toBe(challenge.value);
    });
  });

  describe("resetControlToken", () => {
    it("generates a new token value on reset", async () => {
      const original = await getOrCreateControlToken(backend, "ipc");
      const rotated = await resetControlToken(backend, "ipc");
      expect(rotated.value).not.toBe(original.value);
      expect(rotated.version).toBe(original.version + 1);
    });

    it("increments version on each reset", async () => {
      await getOrCreateControlToken(backend, "ipc");
      const r1 = await resetControlToken(backend, "ipc");
      expect(r1.version).toBe(2);
      const r2 = await resetControlToken(backend, "ipc");
      expect(r2.version).toBe(3);
    });

    it("old token value is immediately invalidated after reset", async () => {
      const original = await getOrCreateControlToken(backend, "ipc");
      await resetControlToken(backend, "ipc");
      const current = await getOrCreateControlToken(backend, "ipc");
      expect(current.value).not.toBe(original.value);
    });
  });

  describe("verifyChallengeResponse", () => {
    it("accepts a valid challenge response against current token", async () => {
      const { createHmac, randomBytes } = await import("node:crypto");
      const token = await getOrCreateControlToken(backend, "ipc");
      const nonceC = randomBytes(16);
      const nonceS = randomBytes(16);
      const role = "desktop";
      const message = Buffer.concat([nonceC, nonceS, Buffer.from(role)]);
      const key = Buffer.from(token.value, "hex");
      const expected = createHmac("sha256", key).update(message).digest();

      const result = await verifyChallengeResponse(
        backend,
        "ipc",
        expected,
        nonceC,
        nonceS,
        role,
      );
      expect(result).toBe(true);
    });

    it("rejects an invalid challenge response (wrong HMAC)", async () => {
      const { randomBytes } = await import("node:crypto");
      await getOrCreateControlToken(backend, "ipc");
      const nonceC = randomBytes(16);
      const nonceS = randomBytes(16);
      const wrongHMAC = randomBytes(32);

      const result = await verifyChallengeResponse(
        backend,
        "ipc",
        wrongHMAC,
        nonceC,
        nonceS,
        "desktop",
      );
      expect(result).toBe(false);
    });

    it("rejects old token value after reset (no grace period)", async () => {
      const { createHmac, randomBytes } = await import("node:crypto");
      const original = await getOrCreateControlToken(backend, "ipc");
      await resetControlToken(backend, "ipc");

      // Use the ORIGINAL (now-invalid) token value to compute HMAC
      const nonceC = randomBytes(16);
      const nonceS = randomBytes(16);
      const role = "desktop";
      const message = Buffer.concat([nonceC, nonceS, Buffer.from(role)]);
      const key = Buffer.from(original.value, "hex");
      const expected = createHmac("sha256", key).update(message).digest();

      // Must be REJECTED — old token is immediately invalid
      const result = await verifyChallengeResponse(
        backend,
        "ipc",
        expected,
        nonceC,
        nonceS,
        role,
      );
      expect(result).toBe(false);
    });
  });

  describe("describe never leaks token value", () => {
    it("describe only shows configured status", async () => {
      await getOrCreateControlToken(backend, "ipc");
      const desc = await backend.describe(__test.tokenRef("ipc"));
      expect(desc).toEqual({ configured: true });
      const serialized = JSON.stringify(desc);
      // Must not contain hex patterns that look like token values
      expect(serialized).not.toMatch(/[0-9a-f]{64}/);
    });
  });
});
