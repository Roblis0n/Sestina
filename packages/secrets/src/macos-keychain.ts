/**
 * macOS Keychain backend.
 *
 * Uses @napi-rs/keyring (prebuilt Rust+N-API) for native Keychain access.
 * There is NO fallback to the `security` CLI — passing secrets via -w
 * leaks them to argv/ps and is a security vulnerability.
 *
 * If native bindings are unavailable, the backend fails closed.
 *
 * Service name: "Sestina"
 * Account: ref with "sestina/" prefix stripped, "/" replaced with "."
 */
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { SecretBackend, SecretBackendStatus, KeychainProvider } from "./port.js";

const SERVICE_NAME = "Sestina";

// ── Ref → account mapping ──

/**
 * Convert a ref to a Keychain account name.
 *
 * COLLISION-FREE ESCAPE SCHEME:
 * - "%"  → "%25" (escape literal percent signs)
 * - "/"  → "%2F" (path separator)
 *
 * This ensures refs like "sestina/a/b" and "sestina/a%2Fb" map to
 * DIFFERENT accounts ("a%2Fb" vs "a%252Fb").
 */
function accountFromRef(ref: string): string {
  return ref
    .replace(/^sestina\//, "")
    .replace(/%/g, "%25")  // escape "%" first (before "/" → "%2F")
    .replace(/\//g, "%2F"); // then encode "/"
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

// ── Backend factory ──

export function createMacOSKeychainBackend(
  keychainProvider?: KeychainProvider,
): SecretBackend {
  let provider: KeychainProvider | null = keychainProvider ?? null;
  let providerResolved = keychainProvider !== undefined;

  async function resolveProvider(): Promise<KeychainProvider> {
    if (!providerResolved) {
      providerResolved = true;
      // Only use native keyring binding. The security CLI is deliberately
      // NOT used as a fallback — passing secrets via -w leaks them to argv.
      const native = await getKeyringNative();
      if (native) {
        provider = createNativeKeychainProvider();
      }
    }
    if (!provider) {
      throw new SestinaError(
        SestinaErrorCode.secure_storage_unavailable,
        "Keychain unavailable: native bindings (@napi-rs/keyring) could not be loaded. " +
        "Set SESTINA_SECRET_<NAME> environment variables to use secrets on this system.",
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
