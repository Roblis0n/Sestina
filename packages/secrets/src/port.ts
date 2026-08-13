/**
 * SecretBackend — the cross-platform secret storage contract.
 *
 * Invariants:
 * - Secrets never enter plain config, database, logs, argv, stderr,
 *   exceptions, snapshots, or test output.
 * - Linux without a secure backend MUST return secure_storage_unavailable;
 *   never fall back to plaintext.
 * - Platform adapters use only official OS APIs (DPAPI, Keychain, Secret Service).
 */

import { existsSync } from "node:fs";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { ACLProvider, VaultIO } from "./windows-dpapi.js";
import { registerControlTokenCoordination } from "./control-token.js";

/** Supported host platforms for secret backend selection. */
export type SecretPlatform = "win32" | "darwin" | "linux";

/** Outcome of a backend probe — used before calling set/get. */
export interface SecretBackendStatus {
  available: boolean;
  backend: "dpapi" | "keychain" | "secret-service" | "environment" | "none";
  /** Human-readable reason when unavailable (never contains secret material). */
  reason?: string;
}

/**
 * Cross-platform secret storage interface.
 * Missing entries return undefined. When the backend itself is unavailable,
 * get/set/delete throw SestinaError with code secure_storage_unavailable.
 */
export interface SecretBackend {
  /** Retrieve a secret by its stable reference key. Returns undefined if not found. */
  get(ref: string): Promise<string | undefined>;

  /** Store (or overwrite) a secret under a stable reference key. */
  set(ref: string, value: string): Promise<void>;

  /** Remove a secret. No-op if it does not exist. */
  delete(ref: string): Promise<void>;

  /** Describe whether a secret is configured, WITHOUT revealing its value. */
  describe(ref: string): Promise<{ configured: boolean }>;

  /** Probe whether this backend is available on the current machine. */
  health(): Promise<SecretBackendStatus>;
}

/**
 * Platform-specific dependencies injected into each backend factory.
 * Each backend receives only the deps it needs; the rest are undefined.
 */
export interface SecretBackendDeps {
  /** Windows: a DPAPI native provider. */
  dpapi?: DPAPIProvider;
  /** Windows: isolated vault path and publication dependencies. */
  windowsVaultPath?: string;
  windowsVaultIO?: VaultIO;
  windowsACL?: ACLProvider;
  /** macOS: a Keychain native provider. */
  keychain?: KeychainProvider;
  /** Linux: a Secret Service provider. */
  secretService?: SecretServiceProvider;
  /** Environment variable reader (injected for testability). */
  envReader?: EnvReader;
  /** Crypto random bytes (injected for testability of control tokens). */
  randomBytes?: (size: number) => Buffer;
}

/** Windows DPAPI provider — encrypt/decrypt for CurrentUser only. */
export interface DPAPIProvider {
  protect(data: Buffer, scope: "CurrentUser"): Promise<Buffer>;
  unprotect(data: Buffer, scope: "CurrentUser"): Promise<Buffer>;
}

/** macOS Keychain provider. */
export interface KeychainProvider {
  addGenericPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  findGenericPassword(
    service: string,
    account: string,
  ): Promise<string | undefined>;
  deleteGenericPassword(service: string, account: string): Promise<void>;
}

/** Linux Secret Service provider (org.freedesktop.Secret.Service). */
export interface SecretServiceProvider {
  lookup(attributes: Record<string, string>): Promise<string | undefined>;
  store(
    attributes: Record<string, string>,
    label: string,
    secret: string,
  ): Promise<void>;
  delete(attributes: Record<string, string>): Promise<void>;
  /** Returns true if the Secret Service daemon is reachable. */
  isAvailable(): Promise<boolean>;
}

/** Injected environment reader — returns undefined when a var is not set. */
export interface EnvReader {
  read(key: string): string | undefined;
  keys(): string[];
}

/**
 * Create the appropriate SecretBackend for the given platform.
 *
 * - win32  → CurrentUser DPAPI
 * - darwin → Keychain
 * - linux  → Secret Service; environment storage only after explicit opt-in
 *
 * @param platform  The OS platform string (process.platform).
 * @param deps      Optional dependency injection for testing.
 */
export function createSecretBackend(
  platform: SecretPlatform,
  deps?: SecretBackendDeps,
): SecretBackend {
  switch (platform) {
    case "win32": {
      // Windows: DPAPI CurrentUser only.
      return createLazyWindowsBackend(deps);
    }
    case "darwin": {
      // macOS: native Keychain binding only; never pass secrets via CLI argv.
      return createLazyMacOSBackend(deps?.keychain);
    }
    case "linux": {
      // Linux: explicit environment opt-in wins; otherwise Secret Service.
      return createLinuxBackend(deps?.secretService, deps?.envReader);
    }
    default:
      throw new Error(`Unsupported platform: ${String(platform)}`);
  }
}

// ── Lazy backend wrappers (defer native module loading to first use) ──

function createLazyWindowsBackend(deps?: SecretBackendDeps): SecretBackend {
  let backend: SecretBackend | null = null;
  let initError: Error | null = null;

  async function init(): Promise<SecretBackend> {
    if (backend) return backend;
    if (initError) throw initError;
    try {
      const { createWindowsDPAPIBackend } = await import("./windows-dpapi.js");
      backend = createWindowsDPAPIBackend(
        deps?.dpapi,
        deps?.windowsVaultPath,
        deps?.windowsVaultIO,
        deps?.windowsACL,
      );
      return backend;
    } catch (err) {
      void err;
      initError = new SestinaError(
        SestinaErrorCode.secure_storage_unavailable,
        "Windows secure storage could not be initialized.",
      );
      throw initError;
    }
  }

  const facade: SecretBackend = {
    async get(ref) {
      return (await init()).get(ref);
    },
    async set(ref, value) {
      return (await init()).set(ref, value);
    },
    async delete(ref) {
      return (await init()).delete(ref);
    },
    async describe(ref) {
      return (await init()).describe(ref);
    },
    async health() {
      try {
        return await (await init()).health();
      } catch {
        return {
          available: false,
          backend: "none" as const,
          reason: "Windows secure storage is unavailable.",
        };
      }
    },
  };
  registerControlTokenCoordination(facade, "windows:current-user");
  return facade;
}

function createLazyMacOSBackend(injectedKC?: KeychainProvider): SecretBackend {
  let backend: SecretBackend | null = null;
  let initError: Error | null = null;

  async function init(): Promise<SecretBackend> {
    if (backend) return backend;
    if (initError) throw initError;
    try {
      const { createMacOSKeychainBackend } =
        await import("./macos-keychain.js");
      backend = createMacOSKeychainBackend(injectedKC);
      return backend;
    } catch (err) {
      void err;
      initError = new SestinaError(
        SestinaErrorCode.secure_storage_unavailable,
        "macOS secure storage could not be initialized.",
      );
      throw initError;
    }
  }

  const facade: SecretBackend = {
    async get(ref) {
      return (await init()).get(ref);
    },
    async set(ref, value) {
      return (await init()).set(ref, value);
    },
    async delete(ref) {
      return (await init()).delete(ref);
    },
    async describe(ref) {
      return (await init()).describe(ref);
    },
    async health() {
      try {
        return await (await init()).health();
      } catch {
        return {
          available: false,
          backend: "none" as const,
          reason: "macOS secure storage is unavailable.",
        };
      }
    },
  };
  registerControlTokenCoordination(facade, "macos:current-user");
  return facade;
}

function createLinuxBackend(
  injectedSS?: SecretServiceProvider,
  injectedEnv?: EnvReader,
): SecretBackend {
  // Environment storage is never selected implicitly. When the user opts in,
  // honor that choice even if a session D-Bus exists but no keyring service is
  // registered on it.
  if (process.env.SESTINA_USE_ENV_BACKEND === "true") {
    let cachedEnv: SecretBackend | null = null;

    async function getEnvBackend(): Promise<SecretBackend> {
      if (cachedEnv) return cachedEnv;
      const { createEnvironmentBackend } = await import("./environment.js");
      cachedEnv = createEnvironmentBackend(injectedEnv);
      return cachedEnv;
    }

    const facade: SecretBackend = {
      async get(ref: string) {
        return (await getEnvBackend()).get(ref);
      },
      async set(ref: string, value: string) {
        return (await getEnvBackend()).set(ref, value);
      },
      async delete(ref: string) {
        return (await getEnvBackend()).delete(ref);
      },
      async describe(ref: string) {
        return (await getEnvBackend()).describe(ref);
      },
      health(): Promise<SecretBackendStatus> {
        return Promise.resolve({
          available: true,
          backend: "environment",
          reason:
            "Reading pre-provisioned secrets from SESTINA_SECRET_* " +
            "environment variables (explicitly enabled).",
        });
      },
    };
    registerControlTokenCoordination(facade, "linux:environment");
    return facade;
  }

  // Determine backend synchronously — the choice is stable for the process lifetime.
  let dbusAvailable = false;
  if (process.env.DBUS_SESSION_BUS_ADDRESS) {
    dbusAvailable = true;
  } else if (process.env.XDG_RUNTIME_DIR) {
    dbusAvailable = existsSync(`${process.env.XDG_RUNTIME_DIR}/bus`);
  }

  if (dbusAvailable || injectedSS) {
    // Use Secret Service (with lazy native load inside)
    let backend: SecretBackend | null = null;
    let ssInitialized = false;

    async function init(): Promise<SecretBackend> {
      if (backend) return backend;
      if (!ssInitialized) {
        ssInitialized = true;
        const { createLinuxSecretBackend } =
          await import("./linux-secret-service.js");
        backend = createLinuxSecretBackend(injectedSS);
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return backend!;
    }

    const facade: SecretBackend = {
      async get(ref) {
        return (await init()).get(ref);
      },
      async set(ref, value) {
        return (await init()).set(ref, value);
      },
      async delete(ref) {
        return (await init()).delete(ref);
      },
      async describe(ref) {
        return (await init()).describe(ref);
      },
      async health() {
        return (await init()).health();
      },
    };
    registerControlTokenCoordination(
      facade,
      "linux:current-user:secret-service",
    );
    return facade;
  }

  // Fail closed: no session D-Bus and no explicit env backend opt-in.
  const unavailableBackend: SecretBackend = {
    get(ref: string): Promise<undefined> {
      void ref;
      return Promise.reject(
        new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          "Secret Service is not available on this Linux system. " +
            "Install and start gnome-keyring-daemon or kwalletd6, " +
            "or explicitly opt in to environment variable storage by setting " +
            "SESTINA_USE_ENV_BACKEND=true and providing secrets via SESTINA_SECRET_<NAME>.",
        ),
      );
    },
    set(ref: string, _value: string): Promise<void> {
      void ref;
      void _value;
      return Promise.reject(
        new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          "Secret Service is not available. Set SESTINA_USE_ENV_BACKEND=true " +
            "and provide secrets via SESTINA_SECRET_<NAME> environment variables.",
        ),
      );
    },
    delete(ref: string): Promise<void> {
      void ref;
      return Promise.reject(
        new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          "Secret Service is not available. Set SESTINA_USE_ENV_BACKEND=true " +
            "and provide secrets via SESTINA_SECRET_<NAME> environment variables.",
        ),
      );
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async describe(ref: string): Promise<{ configured: boolean }> {
      void ref;
      return { configured: false };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async health(): Promise<SecretBackendStatus> {
      return {
        available: false,
        backend: "none",
        reason:
          "Secret Service (D-Bus) is not available on this system. " +
          "Install and start gnome-keyring-daemon or kwalletd6, " +
          "or set SESTINA_USE_ENV_BACKEND=true with SESTINA_SECRET_<NAME> variables.",
      };
    },
  };

  return unavailableBackend;
}

// ── Control Token ──

/** Scope discriminator for control tokens. */
export type ControlTokenScope = "ipc" | "challenge";

/** A versioned control token stored in the OS secret backend. */
export interface ControlToken {
  /** Stable reference key used in the secret backend. */
  ref: string;
  /** Monotonically increasing version. */
  version: number;
  /** The 256-bit random token value (only returned at creation/reset). */
  value: string;
}

// Re-export control token functions from the implementation module
export {
  getOrCreateControlToken,
  resetControlToken,
  verifyChallengeResponse,
} from "./control-token.js";
