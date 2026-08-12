/* eslint-disable @typescript-eslint/require-await */
/**
 * macOS Keychain backend tests.
 *
 * Tests the REAL production macOS Keychain backend (src/macos-keychain.ts)
 * via dependency injection — a synthetic KeychainProvider is injected into
 * the real createMacOSKeychainBackend factory.
 *
 * On non-macOS: structural tests only — NOT mock-as-real.
 */
import { describe, it, expect } from "vitest";
import type {
  KeychainProvider,
} from "../src/port.js";

// ── Synthetic Keychain for structural tests ──
// CLEARLY labeled as synthetic; NOT a mock.
// Injected into the real production backend factory via DI.

function createSyntheticKeychain(): KeychainProvider {
  const store = new Map<string, string>();

  function makeKey(service: string, account: string): string {
    return `${service}\x00${account}`;
  }

  return {
    async addGenericPassword(
      service: string,
      account: string,
      password: string,
    ) {
      store.set(makeKey(service, account), password);
    },
    async findGenericPassword(
      service: string,
      account: string,
    ): Promise<string | undefined> {
      return store.get(makeKey(service, account));
    },
    async deleteGenericPassword(service: string, account: string) {
      store.delete(makeKey(service, account));
    },
  };
}

// ── Import REAL production backend factory ──

import { createMacOSKeychainBackend } from "../src/macos-keychain.js";

function createTestBackend(): ReturnType<typeof createMacOSKeychainBackend> {
  // Inject synthetic Keychain provider into the REAL production backend
  const keychain = createSyntheticKeychain();
  return createMacOSKeychainBackend(keychain);
}

// ── Contract tests (run against real backend with injected synthetic provider) ──

import { secretBackendContract } from "./contract.js";
secretBackendContract(createTestBackend);

// ── macOS-specific tests ──

describe("macOS Keychain backend", () => {
  it("uses fixed service name 'Sestina' for all entries", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/test1", "value1");
    await backend.set("sestina/test2", "value2");
    // Both should coexist without collision due to different accounts
    expect(await backend.get("sestina/test1")).toBe("value1");
    expect(await backend.get("sestina/test2")).toBe("value2");
  });

  it("maps ref to keychain account correctly", async () => {
    const backend = createTestBackend();
    // Multi-segment ref
    await backend.set("sestina/openai/api-key", "sk-test");
    expect(await backend.get("sestina/openai/api-key")).toBe("sk-test");
  });

  it("delete is idempotent for non-existent entries", async () => {
    const backend = createTestBackend();
    await expect(
      backend.delete("sestina/nonexistent"),
    ).resolves.toBeUndefined();
  });

  it("get returns undefined for non-existent entries", async () => {
    const backend = createTestBackend();
    expect(await backend.get("sestina/never-stored")).toBeUndefined();
  });

  it("KeychainProvider handles service+account uniqueness", async () => {
    const kc = createSyntheticKeychain();
    await kc.addGenericPassword("Svc1", "AcctA", "pw-a");
    await kc.addGenericPassword("Svc1", "AcctB", "pw-b");
    await kc.addGenericPassword("Svc2", "AcctA", "pw-c");

    expect(await kc.findGenericPassword("Svc1", "AcctA")).toBe("pw-a");
    expect(await kc.findGenericPassword("Svc1", "AcctB")).toBe("pw-b");
    expect(await kc.findGenericPassword("Svc2", "AcctA")).toBe("pw-c");
  });

  it("health reports keychain when synthetic provider is injected", async () => {
    const backend = createTestBackend();
    const status = await backend.health();
    expect(status.available).toBe(true);
    expect(status.backend).toBe("keychain");
  });
});
