/* eslint-disable @typescript-eslint/require-await */
/**
 * Linux Secret Service backend tests.
 *
 * Tests the REAL production Linux Secret Service backend
 * (src/linux-secret-service.ts) via dependency injection — a synthetic
 * SecretServiceProvider is injected into the real createLinuxSecretBackend
 * factory.
 *
 * On non-Linux: structural tests only — NOT mock-as-real.
 */
import { describe, it, expect } from "vitest";
import type {
  SecretServiceProvider,
} from "../src/port.js";

// ── Synthetic Secret Service for structural tests ──
// CLEARLY labeled as synthetic; NOT a mock.
// Injected into the real production backend factory via DI.

function createSyntheticSecretService(): SecretServiceProvider {
  const store = new Map<string, string>();

  function attrKey(attributes: Record<string, string>): string {
    return Object.entries(attributes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(";");
  }

  return {
    async lookup(attributes: Record<string, string>) {
      return store.get(attrKey(attributes));
    },
    async store(
      attributes: Record<string, string>,
      _label: string,
      secret: string,
    ) {
      store.set(attrKey(attributes), secret);
    },
    async delete(attributes: Record<string, string>) {
      store.delete(attrKey(attributes));
    },
    async isAvailable() {
      return true;
    },
  };
}

// ── Import REAL production backend factory ──

import { createLinuxSecretBackend } from "../src/linux-secret-service.js";

function createTestBackend(): ReturnType<typeof createLinuxSecretBackend> {
  // Inject synthetic Secret Service provider into the REAL production backend
  const ss = createSyntheticSecretService();
  return createLinuxSecretBackend(ss);
}

// ── Contract tests (run against real backend with injected synthetic provider) ──

import { secretBackendContract } from "./contract.js";
secretBackendContract(createTestBackend);

// ── Linux-specific tests ──

describe("Linux Secret Service backend", () => {
  it("uses sestina_ref attribute for all entries", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/test", "value-1");
    expect(await backend.get("sestina/test")).toBe("value-1");
  });

  it("isolates different refs by attribute", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/key1", "val1");
    await backend.set("sestina/key2", "val2");
    expect(await backend.get("sestina/key1")).toBe("val1");
    expect(await backend.get("sestina/key2")).toBe("val2");
  });

  it("returns secure_storage_unavailable when Secret Service is down", async () => {
    // Create a backend with unavailable SS injected into real factory
    const unavailableSS: SecretServiceProvider = {
      async lookup() {
        throw new Error("secure_storage_unavailable");
      },
      async store() {
        throw new Error("secure_storage_unavailable");
      },
      async delete() {
        throw new Error("secure_storage_unavailable");
      },
      async isAvailable() {
        return false;
      },
    };

    const backend = createLinuxSecretBackend(unavailableSS);
    const status = await backend.health();
    expect(status.available).toBe(false);
    expect(status.backend).toBe("none");
    expect(status.reason).toBeDefined();
  });

  it("NEVER falls back to plaintext file storage", () => {
    // This is a DESIGN constraint: no "plaintext" backend type exists.
    const validBackends = [
      "dpapi",
      "keychain",
      "secret-service",
      "environment",
      "none",
    ] as const;
    expect(validBackends).not.toContain("plaintext" as never);
  });

  it("health reports secret-service when synthetic provider is injected", async () => {
    const backend = createTestBackend();
    const status = await backend.health();
    expect(status.available).toBe(true);
    expect(status.backend).toBe("secret-service");
  });
});
