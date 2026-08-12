/* eslint-disable @typescript-eslint/require-await */
/**
 * Cross-user isolation tests.
 *
 * Verifies that two different OS user scopes with the same ref key
 * are MUTUALLY INVISIBLE through DI-injected production factories.
 *
 * Each backend instance represents a different OS user's vault/keyring.
 * Even with identical ref keys, one user's secrets must be completely
 * inaccessible to the other.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type {
  SecretBackend,
  DPAPIProvider,
  KeychainProvider,
  SecretServiceProvider,
} from "../src/port.js";

// ── Import REAL production backend factories ──

import { createWindowsDPAPIBackend } from "../src/windows-dpapi.js";
import { createMacOSKeychainBackend } from "../src/macos-keychain.js";
import { createLinuxSecretBackend } from "../src/linux-secret-service.js";

// ── Synthetic providers with separate storage per "user" ──

function createUserScopedDPAPI(): DPAPIProvider {
  let counter = 0;
  const XOR_KEY = 0x5a;
  return {
    async protect(data: Buffer, _scope: "CurrentUser") {
      void _scope;
      const id = `synth-${++counter}`;
      const obfuscated = Buffer.from(data.map((b) => b ^ XOR_KEY));
      return Buffer.concat([
        Buffer.from(`SYNTH_DPAPI_V1:${id}:`),
        obfuscated,
      ]);
    },
    async unprotect(data: Buffer, scope: string) {
      if (scope !== "CurrentUser") throw new Error("Only CurrentUser scope is supported");
      const header = data.toString("utf8", 0, 40);
      if (!header.startsWith("SYNTH_DPAPI_V1:")) throw new Error("Invalid DPAPI blob");
      const colonIdx = header.indexOf(":", 15);
      if (colonIdx === -1) throw new Error("Malformed synthetic blob");
      const obfuscated = data.subarray(colonIdx + 1);
      return Buffer.from(obfuscated.map((b) => b ^ XOR_KEY));
    },
  };
}

function createUserScopedKeychain(): KeychainProvider {
  const store = new Map<string, string>();
  return {
    async addGenericPassword(svc: string, acct: string, pw: string) {
      store.set(`${svc}\x00${acct}`, pw);
    },
    async findGenericPassword(svc: string, acct: string) {
      return store.get(`${svc}\x00${acct}`);
    },
    async deleteGenericPassword(svc: string, acct: string) {
      store.delete(`${svc}\x00${acct}`);
    },
  };
}

function createUserScopedSecretService(): SecretServiceProvider {
  const store = new Map<string, string>();
  return {
    async lookup(attrs: Record<string, string>) {
      return store.get(attrs.sestina_ref ?? "");
    },
    async store(attrs: Record<string, string>, _label: string, secret: string) {
      store.set(attrs.sestina_ref ?? "", secret);
    },
    async delete(attrs: Record<string, string>) {
      store.delete(attrs.sestina_ref ?? "");
    },
    async isAvailable() { return true; },
  };
}

// ── Tests ──

describe("cross-user isolation", () => {
  describe("Windows DPAPI backend", () => {
    let userABackend: SecretBackend;
    let userBBackend: SecretBackend;

    beforeEach(() => {
      const tmpA = `${process.env.TEMP ?? "/tmp"}/sestina-user-a-${Date.now()}-a.json`;
      const tmpB = `${process.env.TEMP ?? "/tmp"}/sestina-user-b-${Date.now()}-b.json`;
      userABackend = createWindowsDPAPIBackend(createUserScopedDPAPI(), tmpA);
      userBBackend = createWindowsDPAPIBackend(createUserScopedDPAPI(), tmpB);
    });

    it("same ref stores different values for different users", async () => {
      await userABackend.set("sestina/shared-ref", "user-a-secret");
      await userBBackend.set("sestina/shared-ref", "user-b-secret");

      expect(await userABackend.get("sestina/shared-ref")).toBe("user-a-secret");
      expect(await userBBackend.get("sestina/shared-ref")).toBe("user-b-secret");
      expect(await userABackend.get("sestina/shared-ref"))
        .not.toBe(await userBBackend.get("sestina/shared-ref"));
    });

    it("user A secrets are invisible to user B", async () => {
      await userABackend.set("sestina/user-a-only", "classified-a");
      expect(await userBBackend.get("sestina/user-a-only")).toBeUndefined();
      await userBBackend.set("sestina/user-a-only", "user-b-version");
      expect(await userBBackend.get("sestina/user-a-only")).toBe("user-b-version");
    });

    it("deleting in one user scope does not affect the other", async () => {
      await userABackend.set("sestina/shared-ref", "data-a");
      await userBBackend.set("sestina/shared-ref", "data-b");

      await userABackend.delete("sestina/shared-ref");
      expect(await userABackend.get("sestina/shared-ref")).toBeUndefined();
      expect(await userBBackend.get("sestina/shared-ref")).toBe("data-b");
    });
  });

  describe("macOS Keychain backend", () => {
    let userABackend: SecretBackend;
    let userBBackend: SecretBackend;

    beforeEach(() => {
      userABackend = createMacOSKeychainBackend(createUserScopedKeychain());
      userBBackend = createMacOSKeychainBackend(createUserScopedKeychain());
    });

    it("same ref stores different values for different users", async () => {
      await userABackend.set("sestina/shared-ref", "user-a-macos");
      await userBBackend.set("sestina/shared-ref", "user-b-macos");

      expect(await userABackend.get("sestina/shared-ref")).toBe("user-a-macos");
      expect(await userBBackend.get("sestina/shared-ref")).toBe("user-b-macos");
    });

    it("user A secrets are invisible to user B", async () => {
      await userABackend.set("sestina/exclusive-a", "only-a");
      expect(await userBBackend.get("sestina/exclusive-a")).toBeUndefined();
    });
  });

  describe("Linux Secret Service backend", () => {
    let userABackend: SecretBackend;
    let userBBackend: SecretBackend;

    beforeEach(() => {
      userABackend = createLinuxSecretBackend(createUserScopedSecretService());
      userBBackend = createLinuxSecretBackend(createUserScopedSecretService());
    });

    it("same ref stores different values for different users", async () => {
      await userABackend.set("sestina/shared-ref", "user-a-linux");
      await userBBackend.set("sestina/shared-ref", "user-b-linux");

      expect(await userABackend.get("sestina/shared-ref")).toBe("user-a-linux");
      expect(await userBBackend.get("sestina/shared-ref")).toBe("user-b-linux");
    });

    it("user A secrets are invisible to user B", async () => {
      await userABackend.set("sestina/only-a-linux", "secret-a");
      expect(await userBBackend.get("sestina/only-a-linux")).toBeUndefined();
    });
  });
});
