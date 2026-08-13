/* eslint-disable @typescript-eslint/require-await */
/**
 * Cross-user cryptographic isolation — R5.
 * B uses different auth key to read A's SAME vault. Must reject/return
 * invisible, not just produce garbage.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SestinaErrorCode } from "@sestina/schema";
import type {
  DPAPIProvider,
  KeychainProvider,
  SecretServiceProvider,
} from "../src/port.js";
import { createWindowsDPAPIBackend } from "../src/windows-dpapi.js";
import type { ACLProvider } from "../src/windows-dpapi.js";
import { createMacOSKeychainBackend } from "../src/macos-keychain.js";
import { createLinuxSecretBackend } from "../src/linux-secret-service.js";
import { getOrCreateControlToken } from "../src/control-token.js";

// ── Isolated temp dir ──

let testDir: string;
beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "sestina-iso-"));
});
afterEach(() => {
  rmSync(testDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 25,
  });
});

const silentACL: ACLProvider = {
  applyACL: () => true,
  verifyACL: () => true,
  applyACLToDir: () => undefined,
};

// ── Keyed DPAPI: different keys = different users ──

function createKeyedDPAPI(userKey: number, magic: number): DPAPIProvider {
  let counter = 0;
  const magicByte = magic & 0xff;
  return {
    async protect(data: Buffer, _scope: "CurrentUser") {
      void _scope;
      const id = `user-${++counter}`;
      // Encrypt: first byte is magic, then the XOR'd data
      const enc = Buffer.alloc(data.length + 1);
      enc[0] = magicByte;
      for (let i = 0; i < data.length; i++) {
        const b = data[i];
        if (b !== undefined) enc[i + 1] = b ^ userKey;
      }
      return Buffer.concat([Buffer.from(`KEYED_DPAPI:${id}:`), enc]);
    },
    async unprotect(data: Buffer, scope: string) {
      if (scope !== "CurrentUser") throw new Error("Invalid scope");
      const header = data.toString("utf8", 0, 40);
      if (!header.startsWith("KEYED_DPAPI:"))
        throw new Error("Invalid blob: wrong key material");
      const colonIdx = header.indexOf(":", 12);
      if (colonIdx === -1) throw new Error("Malformed blob");
      const enc = data.subarray(colonIdx + 1);
      // Verify magic byte
      if (enc[0] !== magicByte)
        throw new Error("Invalid blob: wrong encryption key");
      const dec = Buffer.alloc(enc.length - 1);
      for (let i = 0; i < dec.length; i++) {
        const b = enc[i + 1];
        if (b !== undefined) dec[i] = b ^ userKey;
      }
      return dec;
    },
  };
}

// ── R5: Same vault, different key — MUST reject ──

describe("cross-user cryptographic isolation", () => {
  const KEY_A = 0x5a;
  const MAGIC_A = 0x5a;
  const KEY_B = 0xa5;
  const MAGIC_B = 0xa5;

  it("R5: B with different key reading A's SAME vault fails closed", async () => {
    const vaultPath = join(testDir, "shared-vault.json");
    const providerA = createKeyedDPAPI(KEY_A, MAGIC_A);
    const providerB = createKeyedDPAPI(KEY_B, MAGIC_B);

    // User A creates vault and stores secret
    const backendA = createWindowsDPAPIBackend(
      providerA,
      vaultPath,
      undefined,
      silentACL,
    );
    await backendA.set("sestina/classified", "user-a-secret-data");
    expect(await backendA.get("sestina/classified")).toBe("user-a-secret-data");

    // User B tries to read A's SAME vault with different key
    const backendB = createWindowsDPAPIBackend(
      providerB,
      vaultPath,
      undefined,
      silentACL,
    );

    // An existing but unreadable blob is not the same as a missing key. Returning
    // undefined here would allow callers to silently overwrite forensic evidence.
    await expect(backendB.get("sestina/classified")).rejects.toMatchObject({
      code: SestinaErrorCode.secure_storage_unavailable,
    });

    // B's describe must show NOT configured (blob exists on disk but unreadable)
    expect(await backendB.describe("sestina/classified")).toEqual({
      configured: false,
    });
  });

  it("does not rebuild or overwrite an unreadable control token", async () => {
    const vaultPath = join(testDir, "shared-control-token.json");
    const backendA = createWindowsDPAPIBackend(
      createKeyedDPAPI(KEY_A, MAGIC_A),
      vaultPath,
      undefined,
      silentACL,
    );
    const original = await getOrCreateControlToken(backendA, "ipc");
    const before = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(vaultPath, "utf8"),
    );

    const backendB = createWindowsDPAPIBackend(
      createKeyedDPAPI(KEY_B, MAGIC_B),
      vaultPath,
      undefined,
      silentACL,
    );
    await expect(
      getOrCreateControlToken(backendB, "ipc"),
    ).rejects.toMatchObject({
      code: SestinaErrorCode.secure_storage_unavailable,
    });

    const after = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(vaultPath, "utf8"),
    );
    expect(after).toBe(before);
    expect(await backendA.get(original.ref)).toContain(original.value);
  });

  it("same ref stores different values for different users with separate vaults", async () => {
    const beA = createWindowsDPAPIBackend(
      createKeyedDPAPI(KEY_A, MAGIC_A),
      join(testDir, "a.json"),
      undefined,
      silentACL,
    );
    const beB = createWindowsDPAPIBackend(
      createKeyedDPAPI(KEY_B, MAGIC_B),
      join(testDir, "b.json"),
      undefined,
      silentACL,
    );

    await beA.set("sestina/shared", "data-from-A");
    await beB.set("sestina/shared", "data-from-B");

    expect(await beA.get("sestina/shared")).toBe("data-from-A");
    expect(await beB.get("sestina/shared")).toBe("data-from-B");
    expect(await beA.get("sestina/shared")).not.toBe(
      await beB.get("sestina/shared"),
    );
  });

  it("macOS: different key material = different users", async () => {
    const storeA = new Map<string, string>();
    const storeB = new Map<string, string>();
    const kcA: KeychainProvider = {
      async addGenericPassword(s: string, a: string, p: string) {
        storeA.set(`${s}\x00${a}`, p);
      },
      async findGenericPassword(s: string, a: string) {
        return storeA.get(`${s}\x00${a}`);
      },
      async deleteGenericPassword(s: string, a: string) {
        storeA.delete(`${s}\x00${a}`);
      },
    };
    const kcB: KeychainProvider = {
      async addGenericPassword(s: string, a: string, p: string) {
        storeB.set(`${s}\x00${a}`, p);
      },
      async findGenericPassword(s: string, a: string) {
        return storeB.get(`${s}\x00${a}`);
      },
      async deleteGenericPassword(s: string, a: string) {
        storeB.delete(`${s}\x00${a}`);
      },
    };
    const beA = createMacOSKeychainBackend(kcA);
    const beB = createMacOSKeychainBackend(kcB);

    await beA.set("sestina/shared", "macos-a");
    await beB.set("sestina/shared", "macos-b");
    expect(await beA.get("sestina/shared")).toBe("macos-a");
    expect(await beB.get("sestina/shared")).toBe("macos-b");
  });

  it("Linux: different key material = different users", async () => {
    const storeA = new Map<string, string>();
    const storeB = new Map<string, string>();
    const ssA: SecretServiceProvider = {
      async lookup(a: Record<string, string>) {
        return storeA.get(a.sestina_ref ?? "");
      },
      async store(a: Record<string, string>, _l: string, s: string) {
        storeA.set(a.sestina_ref ?? "", s);
      },
      async delete(a: Record<string, string>) {
        storeA.delete(a.sestina_ref ?? "");
      },
      async isAvailable() {
        return true;
      },
    };
    const ssB: SecretServiceProvider = {
      async lookup(a: Record<string, string>) {
        return storeB.get(a.sestina_ref ?? "");
      },
      async store(a: Record<string, string>, _l: string, s: string) {
        storeB.set(a.sestina_ref ?? "", s);
      },
      async delete(a: Record<string, string>) {
        storeB.delete(a.sestina_ref ?? "");
      },
      async isAvailable() {
        return true;
      },
    };
    const beA = createLinuxSecretBackend(ssA);
    const beB = createLinuxSecretBackend(ssB);

    await beA.set("sestina/shared", "linux-a");
    await beB.set("sestina/shared", "linux-b");
    expect(await beA.get("sestina/shared")).toBe("linux-a");
    expect(await beB.get("sestina/shared")).toBe("linux-b");
  });
});
