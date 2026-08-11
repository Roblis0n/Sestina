/**
 * macOS Keychain backend.
 *
 * Uses @napi-rs/keyring (prebuilt Rust+N-API) for native Keychain access.
 * Falls back to the `security` CLI if native bindings are unavailable.
 *
 * Service name: "Sestina"
 * Account: ref with "sestina/" prefix stripped, "/" replaced with "."
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretBackend, SecretBackendStatus, KeychainProvider } from "./port.js";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "Sestina";

// ── Ref → account mapping ──

function accountFromRef(ref: string): string {
  return ref.replace(/^sestina\//, "").replace(/\//g, ".");
}

// ── Lazy native loader (keyring-rs via @napi-rs/keyring) ──

interface KeyringNative {
  Entry: new (service: string, account: string) => {
    getPassword(): string | null;
    setPassword(password: string): void;
    deletePassword(): void;
  };
}

let keyringNative: KeyringNative | null = null;
let keyringLoadAttempted = false;

async function getKeyringNative(): Promise<KeyringNative | null> {
  if (keyringLoadAttempted) return keyringNative;
  keyringLoadAttempted = true;
  try {
    const mod = await import("@napi-rs/keyring");
    // Module exports { Entry } directly
    const native = mod as unknown as { Entry?: KeyringNative["Entry"]; default?: { Entry?: KeyringNative["Entry"] } };
    const Entry = native.Entry ?? native.default?.Entry;
    if (!Entry) return null;
    keyringNative = { Entry };
    return keyringNative;
  } catch {
    return null;
  }
}

// ── Native keyring provider ──

export function createNativeKeychainProvider(): KeychainProvider {
  return {
    async addGenericPassword(
      service: string,
      account: string,
      password: string,
    ) {
      const kr = await getKeyringNative();
      if (!kr) throw new Error("keyring native module unavailable");
      const entry = new kr.Entry(service, account);
      entry.setPassword(password);
    },
    async findGenericPassword(
      service: string,
      account: string,
    ): Promise<string | undefined> {
      const kr = await getKeyringNative();
      if (!kr) throw new Error("keyring native module unavailable");
      const entry = new kr.Entry(service, account);
      const pw = entry.getPassword();
      return pw ?? undefined;
    },
    async deleteGenericPassword(service: string, account: string) {
      const kr = await getKeyringNative();
      if (!kr) throw new Error("keyring native module unavailable");
      const entry = new kr.Entry(service, account);
      entry.deletePassword();
    },
  };
}

// ── security CLI provider (fallback) ──

function probeSecurityCLI(): Promise<boolean> {
  return execFileAsync("security", ["list-keychains"], { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
}

export function createSecurityCLIProvider(): KeychainProvider {
  return {
    async addGenericPassword(service, account, password) {
      // NOTE: The macOS `security` CLI requires the password on the command
      // line via -w. This means the secret is visible to same-user processes
      // via `ps`. Prefer the native keyring binding (createNativeKeychainProvider)
      // which avoids this. This CLI provider is a fallback for environments
      // where native bindings cannot be installed.
      await execFileAsync("security", [
        "add-generic-password", "-U",
        "-a", account, "-s", service, "-w", password,
      ], { maxBuffer: 1024 * 1024 });
    },
    async findGenericPassword(service, account) {
      try {
        const { stdout } = await execFileAsync("security", [
          "find-generic-password",
          "-a", account, "-s", service, "-w",
        ]);
        const trimmed = stdout.trim();
        return trimmed || undefined;
      } catch (err: unknown) {
        const code = (err as { code?: string | number }).code;
        // exit code 44 = item not found, exit code 128 + signal = killed
        if (code === "44" || (typeof code === "number" && code === 44)) {
          return undefined;
        }
        throw err;
      }
    },
    async deleteGenericPassword(service, account) {
      try {
        await execFileAsync("security", [
          "delete-generic-password",
          "-a", account, "-s", service,
        ]);
      } catch (err: unknown) {
        const code = (err as { code?: string | number }).code;
        if (code === "44" || (typeof code === "number" && code === 44)) {
          return; // already gone
        }
        throw err;
      }
    },
  };
}

// ── Backend factory ──

export function createMacOSKeychainBackend(
  keychainProvider?: KeychainProvider,
): SecretBackend {
  let provider: KeychainProvider | null = keychainProvider ?? null;
  let providerResolved = keychainProvider !== undefined;

  async function resolveProvider(): Promise<KeychainProvider> {
    if (!providerResolved) {
      providerResolved = true;
      // Try native first
      const native = await getKeyringNative();
      if (native) {
        provider = createNativeKeychainProvider();
      } else {
        // Fall back to security CLI
        const cliOk = await probeSecurityCLI();
        if (cliOk) {
          provider = createSecurityCLIProvider();
        }
      }
    }
    if (!provider) {
      throw new Error(
        "Keychain unavailable: no native bindings and security CLI not functional. " +
        "Set SESTINA_SECRET_<NAME> environment variables instead.",
      );
    }
    return provider;
  }

  return {
    async get(ref: string) {
      const kc = await resolveProvider();
      return kc.findGenericPassword(SERVICE_NAME, accountFromRef(ref));
    },
    async set(ref: string, value: string) {
      const kc = await resolveProvider();
      await kc.addGenericPassword(SERVICE_NAME, accountFromRef(ref), value);
    },
    async delete(ref: string) {
      const kc = await resolveProvider();
      await kc.deleteGenericPassword(SERVICE_NAME, accountFromRef(ref));
    },
    async describe(ref: string) {
      try {
        const kc = await resolveProvider();
        const found = await kc.findGenericPassword(
          SERVICE_NAME,
          accountFromRef(ref),
        );
        return { configured: found !== undefined };
      } catch {
        return { configured: false };
      }
    },
    async health(): Promise<SecretBackendStatus> {
      try {
        await resolveProvider();
        return { available: true, backend: "keychain" };
      } catch (err) {
        return {
          available: false,
          backend: "none",
          reason:
            err instanceof Error
              ? err.message
              : "Keychain is not available on this system",
        };
      }
    },
  };
}
