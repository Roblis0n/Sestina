/* eslint-disable @typescript-eslint/require-await */
/**
 * Factory tests — directly test createSecretBackend and control token functions.
 *
 * These tests verify correct platform routing and token lifecycle
 * using the REAL production code with injected fake backends.
 */
import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  createSecretBackend,
  getOrCreateControlToken,
  resetControlToken,
  verifyChallengeResponse,
} from "../src/index.js";
import type { SecretBackend } from "../src/index.js";

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
    async health() {
      return { available: true, backend: "dpapi" as const };
    },
  };
}

describe("createSecretBackend", () => {
  it("returns a backend for win32", () => {
    const backend = createSecretBackend("win32");
    expect(backend).toBeDefined();
    expect(typeof backend.get).toBe("function");
    expect(typeof backend.set).toBe("function");
    expect(typeof backend.delete).toBe("function");
    expect(typeof backend.describe).toBe("function");
    expect(typeof backend.health).toBe("function");
  });

  it("returns a backend for darwin", () => {
    const backend = createSecretBackend("darwin");
    expect(backend).toBeDefined();
    expect(typeof backend.health).toBe("function");
  });

  it("returns a backend for linux", () => {
    const backend = createSecretBackend("linux");
    expect(backend).toBeDefined();
    expect(typeof backend.health).toBe("function");
  });

  it("throws for unsupported platform", () => {
    expect(() =>
      createSecretBackend("unsupported" as never),
    ).toThrow("Unsupported platform");
  });

  it("win32 backend health reports dpapi or none", async () => {
    const backend = createSecretBackend("win32");
    const status = await backend.health();
    expect(["dpapi", "none"]).toContain(status.backend);
    expect(typeof status.available).toBe("boolean");
  });

  it("darwin backend health reports keychain or none", async () => {
    const backend = createSecretBackend("darwin");
    const status = await backend.health();
    expect(["keychain", "none"]).toContain(status.backend);
    expect(typeof status.available).toBe("boolean");
  });

  it("linux backend health reports secret-service, environment, or none", async () => {
    const backend = createSecretBackend("linux");
    const status = await backend.health();
    expect(["secret-service", "environment", "none"]).toContain(
      status.backend,
    );
    expect(typeof status.available).toBe("boolean");
  });
});

describe("getOrCreateControlToken", () => {
  it("creates a version-1 token on first call", async () => {
    const backend = createFakeBackend();
    const token = await getOrCreateControlToken(backend, "ipc");
    expect(token.version).toBe(1);
    expect(token.value).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token.value)).toBe(true);
  });

  it("returns same token on subsequent calls", async () => {
    const backend = createFakeBackend();
    const first = await getOrCreateControlToken(backend, "ipc");
    const second = await getOrCreateControlToken(backend, "ipc");
    expect(second.value).toBe(first.value);
    expect(second.version).toBe(first.version);
  });
});

describe("resetControlToken", () => {
  it("rotates the token and increments version", async () => {
    const backend = createFakeBackend();
    const original = await getOrCreateControlToken(backend, "ipc");
    const rotated = await resetControlToken(backend, "ipc");
    expect(rotated.value).not.toBe(original.value);
    expect(rotated.version).toBe(original.version + 1);
    const current = await getOrCreateControlToken(backend, "ipc");
    expect(current.value).toBe(rotated.value);
  });

  it("preserves original creation on upgrade (no rotation)", async () => {
    const backend = createFakeBackend();
    const first = await getOrCreateControlToken(backend, "ipc");
    // Simulate restart: new factory call but same backend store
    const second = await getOrCreateControlToken(backend, "ipc");
    expect(second.value).toBe(first.value);
    expect(second.version).toBe(first.version);
  });

  it("creates multiple independent rotations", async () => {
    const backend = createFakeBackend();
    const v1 = await getOrCreateControlToken(backend, "ipc");
    const v2 = await resetControlToken(backend, "ipc");
    const v3 = await resetControlToken(backend, "ipc");
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
    expect(v1.value).not.toBe(v2.value);
    expect(v2.value).not.toBe(v3.value);
  });
});

describe("verifyChallengeResponse", () => {
  it("accepts a valid challenge response against current token", async () => {
    const backend = createFakeBackend();
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
    const backend = createFakeBackend();
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

  it("rejects a challenge response with wrong role", async () => {
    const backend = createFakeBackend();
    const token = await getOrCreateControlToken(backend, "ipc");
    const nonceC = randomBytes(16);
    const nonceS = randomBytes(16);
    const messageDesktop = Buffer.concat([
      nonceC,
      nonceS,
      Buffer.from("desktop"),
    ]);
    const key = Buffer.from(token.value, "hex");
    const hmac = createHmac("sha256", key).update(messageDesktop).digest();
    // Verify with wrong role "mcp"
    const result = await verifyChallengeResponse(
      backend,
      "ipc",
      hmac,
      nonceC,
      nonceS,
      "mcp",
    );
    expect(result).toBe(false);
  });

  it("rejects old token after reset (no grace period)", async () => {
    const backend = createFakeBackend();
    const original = await getOrCreateControlToken(backend, "ipc");
    await resetControlToken(backend, "ipc");

    // Use the ORIGINAL (now-invalid) token value to compute HMAC
    const nonceC = randomBytes(16);
    const nonceS = randomBytes(16);
    const role = "desktop";
    const message = Buffer.concat([nonceC, nonceS, Buffer.from(role)]);
    const key = Buffer.from(original.value, "hex");
    const expected = createHmac("sha256", key).update(message).digest();

    // Must be REJECTED — old token immediately invalid
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
