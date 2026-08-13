/**
 * Linux Secret Service backend.
 *
 * Uses @napi-rs/keyring (which uses the Rust keyring-rs crate → zbus →
 * org.freedesktop.Secret.Service over D-Bus).
 *
 * CRITICAL SAFETY RULES:
 * 1. D-Bus availability checked BEFORE any native import — prevents segfault.
 * 2. If Secret Service is unavailable → throw secure_storage_unavailable.
 * 3. NEVER fall back to plaintext file storage.
 * 4. Environment variable backend is a SEPARATE, user-initiated choice.
 */
import { existsSync } from "node:fs";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type {
  SecretBackend,
  SecretBackendStatus,
  SecretServiceProvider,
} from "./port.js";
import { throwNativeError } from "./errors.js";
import { registerControlTokenCoordination } from "./control-token.js";

// ── D-Bus availability detection (MUST run before any native import) ──

function isDbusAvailable(): boolean {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) return true;
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    const busPath = `${xdgRuntime}/bus`;
    if (existsSync(busPath)) return true;
  }
  return false;
}

// ── Lazy native loader (only called after isDbusAvailable returns true) ──

interface KeyringNative {
  Entry: new (
    service: string,
    account: string,
  ) => {
    getPassword(): string | null;
    setPassword(password: string): void;
    deletePassword(): void;
  };
}

let keyringNative: KeyringNative | null = null;
let loadAttempted = false;

async function getKeyringNative(): Promise<KeyringNative | null> {
  if (loadAttempted) return keyringNative;
  loadAttempted = true;
  if (!isDbusAvailable()) return null;
  try {
    const mod = await import("@napi-rs/keyring");
    const native = mod as unknown as {
      Entry?: KeyringNative["Entry"];
      default?: { Entry?: KeyringNative["Entry"] };
    };
    const Entry = native.Entry ?? native.default?.Entry;
    if (!Entry) return null;
    keyringNative = { Entry };
    return keyringNative;
  } catch {
    return null;
  }
}

// ── Ref → keyring service/account mapping ──

function refToServiceAccount(ref: string): {
  service: string;
  account: string;
} {
  const withoutPrefix = ref.replace(/^sestina\//, "");
  const slashIdx = withoutPrefix.indexOf("/");
  if (slashIdx === -1) {
    return { service: "sestina", account: withoutPrefix };
  }
  return {
    service: `sestina.${withoutPrefix.slice(0, slashIdx)}`,
    account: withoutPrefix.slice(slashIdx + 1),
  };
}

// ── SecretServiceProvider (wraps @napi-rs/keyring) ──

export function createNativeSecretServiceProvider(): SecretServiceProvider {
  return {
    async isAvailable() {
      return (await getKeyringNative()) !== null;
    },

    async lookup(attributes: Record<string, string>) {
      const kr = await getKeyringNative();
      if (!kr) {
        throw new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          "Secret Service is not available on this system.",
        );
      }
      const ref = attributes.sestina_ref ?? "";
      const { service, account } = refToServiceAccount(ref);
      const entry = new kr.Entry(service, account);
      const pw = entry.getPassword();
      return pw ?? undefined;
    },

    async store(
      attributes: Record<string, string>,
      _label: string,
      secret: string,
    ) {
      const kr = await getKeyringNative();
      if (!kr) {
        throw new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          "Secret Service is not available. " +
            "Set SESTINA_SECRET_<NAME> environment variables to store secrets.",
        );
      }
      const ref = attributes.sestina_ref ?? "";
      const { service, account } = refToServiceAccount(ref);
      const entry = new kr.Entry(service, account);
      entry.setPassword(secret);
    },

    async delete(attributes: Record<string, string>) {
      const kr = await getKeyringNative();
      if (!kr) {
        throw new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          "Secret Service is not available.",
        );
      }
      const ref = attributes.sestina_ref ?? "";
      const { service, account } = refToServiceAccount(ref);
      const entry = new kr.Entry(service, account);
      entry.deletePassword(); // idempotent
    },
  };
}

// ── Backend factory ──

export function createLinuxSecretBackend(
  secretService?: SecretServiceProvider,
): SecretBackend {
  const ss = secretService ?? createNativeSecretServiceProvider();

  const backend: SecretBackend = {
    async get(ref: string) {
      try {
        if (!(await ss.isAvailable())) {
          throw new Error("Secret Service unavailable");
        }
        return await ss.lookup({ sestina_ref: ref });
      } catch (error) {
        throwNativeError("Linux Secret Service", "get", error);
      }
    },

    async set(ref: string, value: string) {
      try {
        if (!(await ss.isAvailable())) {
          throw new Error("Secret Service unavailable");
        }
        await ss.store({ sestina_ref: ref }, ref, value);
      } catch (error) {
        throwNativeError("Linux Secret Service", "set", error);
      }
    },

    async delete(ref: string) {
      try {
        if (!(await ss.isAvailable())) {
          throw new Error("Secret Service unavailable");
        }
        await ss.delete({ sestina_ref: ref });
      } catch (error) {
        throwNativeError("Linux Secret Service", "delete", error);
      }
    },

    async describe(ref: string) {
      try {
        if (!(await ss.isAvailable())) return { configured: false };
        const val = await ss.lookup({ sestina_ref: ref });
        return { configured: val !== undefined };
      } catch {
        return { configured: false };
      }
    },

    async health(): Promise<SecretBackendStatus> {
      try {
        const available = await ss.isAvailable();
        return {
          available,
          backend: available ? "secret-service" : "none",
          reason: available
            ? undefined
            : "D-Bus session / Secret Service daemon not reachable. " +
              "Is gnome-keyring-daemon or kwalletd6 running? " +
              "Set SESTINA_SECRET_<NAME> environment variables to use secrets without a keyring.",
        };
      } catch {
        return {
          available: false,
          backend: "none",
          reason: "Secret Service availability check failed.",
        };
      }
    },
  };
  registerControlTokenCoordination(
    backend,
    "linux:current-user:secret-service",
  );
  return backend;
}
