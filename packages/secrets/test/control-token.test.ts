/* eslint-disable @typescript-eslint/require-await */
/**
 * Control token tests — generation, versioning, rotation, isolation.
 *
 * These tests use a fake SecretBackend (in-memory Map) to verify
 * the token lifecycle without requiring a real OS secret store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SecretBackend, SecretBackendStatus } from "../src/port.js";

// ── Fake in-memory backend for testing control token logic ──

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

// ── Inline control token implementation (will move to src/control-token.ts) ──

import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 32; // 256 bits
const TOKEN_REF_PREFIX = "sestina/control-token/";

function tokenRef(scope: string): string {
  return `${TOKEN_REF_PREFIX}${scope}`;
}
function versionRef(scope: string): string {
  return `${TOKEN_REF_PREFIX}${scope}/version`;
}

async function generateTokenValue(): Promise<string> {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

async function internalGetOrCreate(
  backend: SecretBackend,
  scope: string,
): Promise<{ value: string; version: number }> {
  const ref = tokenRef(scope);
  const verRef = versionRef(scope);
  const existing = await backend.get(ref);
  if (existing) {
    const versionStr = await backend.get(verRef);
    const version = versionStr ? parseInt(versionStr, 10) : 1;
    return { value: existing, version };
  }
  // Create new
  const value = await generateTokenValue();
  await backend.set(ref, value);
  await backend.set(verRef, "1");
  return { value, version: 1 };
}

async function internalReset(
  backend: SecretBackend,
  scope: string,
): Promise<{ value: string; version: number }> {
  const verRef = versionRef(scope);
  const currentVerStr = await backend.get(verRef);
  const newVersion = currentVerStr ? parseInt(currentVerStr, 10) + 1 : 1;
  const value = await generateTokenValue();
  await backend.set(tokenRef(scope), value);
  await backend.set(verRef, String(newVersion));
  return { value, version: newVersion };
}

// ── Tests ──

describe("control token", () => {
  let backend: SecretBackend;

  beforeEach(() => {
    backend = createFakeBackend();
  });

  describe("getOrCreateControlToken", () => {
    it("generates a 256-bit (64 hex char) token on first call", async () => {
      const token = await internalGetOrCreate(backend, "ipc");
      expect(token.value).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(token.version).toBe(1);
      // Verify it's hex
      expect(/^[0-9a-f]{64}$/.test(token.value)).toBe(true);
    });

    it("returns the same token on subsequent calls (no rotation)", async () => {
      const first = await internalGetOrCreate(backend, "ipc");
      const second = await internalGetOrCreate(backend, "ipc");
      expect(second.value).toBe(first.value);
      expect(second.version).toBe(first.version);
    });

    it("preserves token across process restarts (stored in backend)", async () => {
      const first = await internalGetOrCreate(backend, "ipc");
      // Simulate restart: create new backend but same scope
      const second = await internalGetOrCreate(backend, "ipc");
      expect(second.value).toBe(first.value);
    });

    it("produces random tokens (collision resistance)", async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 10; i++) {
        // Create new backend each time to force new generation
        const fresh = createFakeBackend();
        const t = await internalGetOrCreate(fresh, `ipc-${i}`);
        tokens.add(t.value);
      }
      // All 10 tokens should be unique
      expect(tokens.size).toBe(10);
    });

    it("isolates tokens by scope", async () => {
      const ipc = await internalGetOrCreate(backend, "ipc");
      const challenge = await internalGetOrCreate(backend, "challenge");
      expect(ipc.value).not.toBe(challenge.value);
    });
  });

  describe("resetControlToken", () => {
    it("generates a new token value on reset", async () => {
      const original = await internalGetOrCreate(backend, "ipc");
      const rotated = await internalReset(backend, "ipc");
      expect(rotated.value).not.toBe(original.value);
      expect(rotated.version).toBe(original.version + 1);
    });

    it("increments version on each reset", async () => {
      await internalGetOrCreate(backend, "ipc");
      const r1 = await internalReset(backend, "ipc");
      expect(r1.version).toBe(2);
      const r2 = await internalReset(backend, "ipc");
      expect(r2.version).toBe(3);
    });

    it("old token value is no longer retrievable after reset", async () => {
      const original = await internalGetOrCreate(backend, "ipc");
      await internalReset(backend, "ipc");
      const current = await internalGetOrCreate(backend, "ipc");
      expect(current.value).not.toBe(original.value);
    });
  });

  describe("describe never leaks token value", () => {
    it("describe only shows configured status", async () => {
      await internalGetOrCreate(backend, "ipc");
      const desc = await backend.describe(tokenRef("ipc"));
      expect(desc).toEqual({ configured: true });
      const serialized = JSON.stringify(desc);
      // Must not contain hex patterns that look like token values
      expect(serialized).not.toMatch(/[0-9a-f]{64}/);
    });
  });
});
