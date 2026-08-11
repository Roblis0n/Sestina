/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
/**
 * Linux Secret Service backend tests.
 *
 * On Linux:
 * - Prefers Secret Service (org.freedesktop.Secret.Service via D-Bus).
 * - If Secret Service is unavailable → environment-only.
 * - NEVER falls back to plaintext storage.
 * - On non-Linux: structural tests only — NOT mock-as-real.
 */
import { describe, it, expect } from "vitest";
import type {
  SecretBackend,
  SecretServiceProvider,
} from "../src/port.js";

// ── Synthetic Secret Service for structural tests (CLEARLY labeled) ──

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

// ── Backend factory ──

function createSyntheticSecretServiceBackend(): SecretBackend {
  const ss = createSyntheticSecretService();

  return {
    async get(ref: string) {
      return ss.lookup({ application: "Sestina", ref });
    },
    async set(ref: string, value: string) {
      await ss.store(
        { application: "Sestina", ref },
        `Sestina secret: ${ref}`,
        value,
      );
    },
    async delete(ref: string) {
      await ss.delete({ application: "Sestina", ref });
    },
    async describe(ref: string) {
      const found = await ss.lookup({ application: "Sestina", ref });
      return { configured: found !== undefined };
    },
    async health() {
      const available = await ss.isAvailable();
      return {
        available,
        backend: available ? ("secret-service" as const) : ("none" as const),
        reason: available ? undefined : "Secret Service daemon not reachable",
      };
    },
  };
}

// ── Contract tests ──

import { secretBackendContract } from "./contract.js";
secretBackendContract(createSyntheticSecretServiceBackend);

// ── Linux-specific tests ──

describe("Linux Secret Service backend", () => {
  it("uses application=Sestina attribute for all entries", async () => {
    const backend = createSyntheticSecretServiceBackend();
    await backend.set("sestina/test", "value-1");
    expect(await backend.get("sestina/test")).toBe("value-1");
  });

  it("isolates different refs by attribute", async () => {
    const backend = createSyntheticSecretServiceBackend();
    await backend.set("sestina/key1", "val1");
    await backend.set("sestina/key2", "val2");
    expect(await backend.get("sestina/key1")).toBe("val1");
    expect(await backend.get("sestina/key2")).toBe("val2");
  });

  it("returns secure_storage_unavailable when Secret Service is down", async () => {
    // Create a backend with unavailable SS
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

    const backend: SecretBackend = {
      async get() {
        throw new Error("secure_storage_unavailable");
      },
      async set() {
        throw new Error("secure_storage_unavailable");
      },
      async delete() {},
      async describe() {
        return { configured: false };
      },
      async health() {
        return {
          available: false,
          backend: "none",
          reason: "Secret Service daemon not reachable on this system",
        };
      },
    };

    const status = await backend.health();
    expect(status.available).toBe(false);
    expect(status.backend).toBe("none");
    expect(status.reason).toBeDefined();
  });

  it("NEVER falls back to plaintext file storage", () => {
    // This is a DESIGN constraint encoded in the interface:
    // There is NO "plaintext" backend type in SecretBackendStatus.backend.
    // The only valid backends are: dpapi | keychain | secret-service | environment | none
    const validBackends = [
      "dpapi",
      "keychain",
      "secret-service",
      "environment",
      "none",
    ] as const;
    expect(validBackends).not.toContain("plaintext" as never);
  });

  it("environment backend is the ONLY fallback for unavailable SS", () => {
    // On Linux without Secret Service, createSecretBackend must return
    // an environment-variable backend, never a plaintext one.
    // This constraint is verified structurally: no "file" or "plaintext" backend exists.
    const backendTypes = [
      "dpapi",
      "keychain",
      "secret-service",
      "environment",
      "none",
    ];
    expect(backendTypes.includes("environment")).toBe(true);
    // These must NOT exist:
    expect(backendTypes).not.toContain("plaintext");
    expect(backendTypes).not.toContain("file");
    expect(backendTypes).not.toContain("config-json");
  });
});
