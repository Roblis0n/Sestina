/* eslint-disable @typescript-eslint/require-await */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SestinaErrorCode } from "@sestina/schema";
import type { KeychainProvider, SecretServiceProvider } from "../src/port.js";
import { createMacOSKeychainBackend } from "../src/macos-keychain.js";
import { createLinuxSecretBackend } from "../src/linux-secret-service.js";

const CANARY = "sestina-native-canary-4f8d-qa";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureStderr(): string[] {
  const writes: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  return writes;
}

describe("platform-native error boundaries", () => {
  it.each(["get", "set", "delete"] as const)(
    "macOS %s wraps and suppresses secret-bearing native errors",
    async (operation) => {
      const writes = captureStderr();
      const provider: KeychainProvider = {
        async addGenericPassword() {
          throw new Error(`native ${CANARY}`);
        },
        async findGenericPassword() {
          throw new Error(`native ${CANARY}`);
        },
        async deleteGenericPassword() {
          throw new Error(`native ${CANARY}`);
        },
      };
      const backend = createMacOSKeychainBackend(provider);
      const call =
        operation === "get"
          ? backend.get("sestina/test")
          : operation === "set"
            ? backend.set("sestina/test", "value")
            : backend.delete("sestina/test");

      await expect(call).rejects.toMatchObject({
        code: SestinaErrorCode.secure_storage_unavailable,
      });
      await expect(call).rejects.not.toThrow(CANARY);
      expect(writes.join("")).not.toContain(CANARY);
    },
  );

  it.each(["get", "set", "delete"] as const)(
    "Linux %s wraps and suppresses secret-bearing native errors",
    async (operation) => {
      const writes = captureStderr();
      const provider: SecretServiceProvider = {
        async isAvailable() {
          return true;
        },
        async lookup() {
          throw new Error(`native ${CANARY}`);
        },
        async store() {
          throw new Error(`native ${CANARY}`);
        },
        async delete() {
          throw new Error(`native ${CANARY}`);
        },
      };
      const backend = createLinuxSecretBackend(provider);
      const call =
        operation === "get"
          ? backend.get("sestina/test")
          : operation === "set"
            ? backend.set("sestina/test", "value")
            : backend.delete("sestina/test");

      await expect(call).rejects.toMatchObject({
        code: SestinaErrorCode.secure_storage_unavailable,
      });
      await expect(call).rejects.not.toThrow(CANARY);
      expect(writes.join("")).not.toContain(CANARY);
    },
  );

  it("Linux health converts an availability probe failure into a sanitized status", async () => {
    const writes = captureStderr();
    const provider: SecretServiceProvider = {
      async isAvailable() {
        throw new Error(`native ${CANARY}`);
      },
      async lookup() {
        return undefined;
      },
      async store() {
        /* unreachable */
      },
      async delete() {
        /* unreachable */
      },
    };

    await expect(createLinuxSecretBackend(provider).health()).resolves.toEqual({
      available: false,
      backend: "none",
      reason: "Secret Service availability check failed.",
    });
    expect(writes.join("")).not.toContain(CANARY);
  });
});
