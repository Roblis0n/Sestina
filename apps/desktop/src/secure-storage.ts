import { safeStorage } from "electron";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { SecretBackend, SecretBackendStatus } from "@sestina/core";

/** Only OS-encrypted bytes are persisted. basic_text is never an acceptable backend. */
export function createDesktopSecrets(directory: string): SecretBackend {
  const file = (ref: string) =>
    join(directory, createHash("sha256").update(ref).digest("hex") + ".enc");
  const health = (): Promise<SecretBackendStatus> => {
    const available =
      safeStorage.isEncryptionAvailable() &&
      !(
        process.platform === "linux" &&
        ["basic_text", "unknown"].includes(
          safeStorage.getSelectedStorageBackend(),
        )
      );
    return Promise.resolve({
      available,
      backend: available
        ? process.platform === "win32"
          ? "dpapi"
          : process.platform === "darwin"
            ? "keychain"
            : "secret-service"
        : "none",
    });
  };
  const requireAvailable = async () => {
    if (!(await health()).available)
      throw new Error("secure_storage_unavailable");
  };
  const get = async (ref: string) => {
    await requireAvailable();
    try {
      return safeStorage.decryptString(await readFile(file(ref)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("secure_storage_unavailable", { cause: e });
    }
  };
  return {
    health,
    get,
    async set(ref, value) {
      await requireAvailable();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const encrypted = safeStorage.encryptString(value);
      if (safeStorage.decryptString(encrypted) !== value)
        throw new Error("secure_storage_unavailable");
      const pending = file(ref) + ".pending";
      await writeFile(pending, encrypted, { flag: "wx", mode: 0o600 });
      await rename(pending, file(ref));
      if ((await get(ref)) !== value)
        throw new Error("secure_storage_unavailable");
    },
    async delete(ref) {
      await requireAvailable();
      const { unlink } = await import("node:fs/promises");
      await unlink(file(ref)).catch((e: unknown) => {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("secure_storage_unavailable");
      });
    },
    async describe(ref) {
      return { configured: (await get(ref)) !== undefined };
    },
  };
}
