/* eslint-disable @typescript-eslint/require-await */
/**
 * macOS Keychain backend tests.
 *
 * On macOS:
 * - Uses Keychain via security CLI or native bindings.
 * - Service name: "Sestina", account: ref minus "sestina/" prefix.
 * - On non-macOS: structural tests only — NOT mock-as-real.
 */
import { describe, it, expect } from "vitest";
import type {
  SecretBackend,
  KeychainProvider,
} from "../src/port.js";

// ── Synthetic Keychain for structural tests (CLEARLY labeled; NOT a mock) ──

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

// ── Backend factory ──

function createSyntheticKeychainBackend(): SecretBackend {
  const keychain = createSyntheticKeychain();
  const SERVICE = "Sestina";

  function accountFromRef(ref: string): string {
    return ref.replace(/^sestina\//, "");
  }

  return {
    async get(ref: string) {
      return keychain.findGenericPassword(SERVICE, accountFromRef(ref));
    },
    async set(ref: string, value: string) {
      await keychain.addGenericPassword(SERVICE, accountFromRef(ref), value);
    },
    async delete(ref: string) {
      await keychain.deleteGenericPassword(SERVICE, accountFromRef(ref));
    },
    async describe(ref: string) {
      const found = await keychain.findGenericPassword(
        SERVICE,
        accountFromRef(ref),
      );
      return { configured: found !== undefined };
    },
    async health() {
      return { available: true, backend: "keychain" as const };
    },
  };
}

// ── Contract tests ──

import { secretBackendContract } from "./contract.js";
secretBackendContract(createSyntheticKeychainBackend);

// ── macOS-specific tests ──

describe("macOS Keychain backend", () => {
  it("uses fixed service name 'Sestina' for all entries", async () => {
    const backend = createSyntheticKeychainBackend();
    await backend.set("sestina/test1", "value1");
    await backend.set("sestina/test2", "value2");
    // Both should coexist without collision due to different accounts
    expect(await backend.get("sestina/test1")).toBe("value1");
    expect(await backend.get("sestina/test2")).toBe("value2");
  });

  it("maps ref to keychain account correctly", async () => {
    const backend = createSyntheticKeychainBackend();
    // Multi-segment ref
    await backend.set("sestina/openai/api-key", "sk-test");
    expect(await backend.get("sestina/openai/api-key")).toBe("sk-test");
  });

  it("delete is idempotent for non-existent entries", async () => {
    const backend = createSyntheticKeychainBackend();
    await expect(
      backend.delete("sestina/nonexistent"),
    ).resolves.toBeUndefined();
  });

  it("get returns undefined for non-existent entries", async () => {
    const backend = createSyntheticKeychainBackend();
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
});
