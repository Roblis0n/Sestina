/**
 * Windows DPAPI backend — CurrentUser scope only.
 *
 * Uses @primno/dpapi (prebuilt native addon wrapping CryptProtectData /
 * CryptUnprotectData from Crypt32.dll).
 *
 * Each entry is individually DPAPI-encrypted and persisted to a JSON
 * vault file on disk, so secrets (including control tokens) survive
 * process restarts.
 *
 * Invariants:
 * - Only CurrentUser scope (NEVER LocalMachine).
 * - Runtime guard rejects any non-CurrentUser scope.
 * - Verifies round-trip on first use (smoke test).
 * - On-disk vault contains only DPAPI-encrypted blobs (no plaintext).
 * - Atomic writes via temp-file + rename (no partial writes).
 * - Corruption detection on load with degraded-mode fallback.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { SecretBackend, SecretBackendStatus, DPAPIProvider } from "./port.js";

// ── Vault path ──

function defaultVaultPath(): string {
  const base = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? homedir();
  return `${base}/Sestina/secrets/vault.json`;
}

// ── Lazy native loader ──

interface DPAPINative {
  isPlatformSupported: boolean;
  Dpapi: {
    protectData(
      data: Uint8Array,
      optionalEntropy: Uint8Array | null,
      scope: "CurrentUser" | "LocalMachine",
    ): Uint8Array;
    unprotectData(
      data: Uint8Array,
      optionalEntropy: Uint8Array | null,
      scope: "CurrentUser" | "LocalMachine",
    ): Uint8Array;
  };
}

let dpapiNative: DPAPINative | null = null;
let loadAttempted = false;
let loadError: string | undefined;

async function getDPAPI(): Promise<DPAPINative | null> {
  if (loadAttempted) return dpapiNative;
  loadAttempted = true;
  try {
    const mod = await import("@primno/dpapi");
    const native = mod as unknown as {
      default?: DPAPINative;
      isPlatformSupported?: boolean;
      Dpapi?: DPAPINative["Dpapi"];
    };
    dpapiNative = {
      isPlatformSupported: native.isPlatformSupported ?? false,
      Dpapi: native.Dpapi ?? native.default?.Dpapi ?? {
        protectData: () => {
          throw new Error("DPAPI not available");
        },
        unprotectData: () => {
          throw new Error("DPAPI not available");
        },
      },
    };
    if (!dpapiNative.isPlatformSupported) {
      loadError =
        "DPAPI platform not supported (non-Windows or unsupported arch)";
      dpapiNative = null;
    }
    return dpapiNative;
  } catch (err) {
    loadError =
      err instanceof Error
        ? err.message
        : "DPAPI native module failed to load";
    return null;
  }
}

// ── DPAPI provider (wraps native module) ──

function guardScope(scope: string): asserts scope is "CurrentUser" {
  if (scope !== "CurrentUser") {
    throw new Error(
      "Only CurrentUser DPAPI scope is supported. LocalMachine is rejected.",
    );
  }
}

export function createWindowsDPAPIProvider(): DPAPIProvider {
  return {
    async protect(data: Buffer, scope: "CurrentUser"): Promise<Buffer> {
      guardScope(scope);
      const dpapi = await getDPAPI();
      if (!dpapi) {
        throw new Error(`DPAPI unavailable: ${loadError ?? "unknown error"}`);
      }
      const result = dpapi.Dpapi.protectData(data, null, scope);
      return Buffer.from(result);
    },
    async unprotect(data: Buffer, scope: "CurrentUser"): Promise<Buffer> {
      guardScope(scope);
      const dpapi = await getDPAPI();
      if (!dpapi) {
        throw new Error(`DPAPI unavailable: ${loadError ?? "unknown error"}`);
      }
      const result = dpapi.Dpapi.unprotectData(data, null, scope);
      return Buffer.from(result);
    },
  };
}

// ── Disk-persisted vault (atomic writes + corruption detection) ──

/**
 * Load the vault from disk. Returns a Map of ref → encrypted-hex.
 *
 * Corruption handling:
 * - If the vault file is missing → empty Map (first run).
 * - If the vault file is unparseable → empty Map, original file
 *   renamed to vault.json.corrupt for forensic recovery.
 * - If any entry value is not valid hex → entry skipped (not plaintext).
 */
function loadVault(path: string): Map<string, string> {
  try {
    if (!existsSync(path)) return new Map();
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      // Structural corruption: not a key-value object
      handleCorruption(path, "vault root is not a JSON object");
      return new Map();
    }
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") {
        // Skip non-string values (corrupt entry)
        continue;
      }
      // Validate that the value is hex-encoded (only DPAPI blobs allowed)
      if (!/^[0-9a-fA-F]+$/.test(value)) {
        // Non-hex value found — possible tampering or plaintext leak.
        // Skip the entry; never return potentially plaintext data.
        continue;
      }
      map.set(key, value);
    }
    return map;
  } catch {
    handleCorruption(path, "JSON parse failure");
    return new Map();
  }
}

/**
 * Handle vault corruption: rename the bad file for forensic recovery.
 */
function handleCorruption(path: string, reason: string): void {
  try {
    const corruptPath = `${path}.corrupt`;
    renameSync(path, corruptPath);
    // Log the event (no secret material in log message)
    const { stderr } = process;
    stderr.write(`[sestina] Vault corruption detected (${reason}). Renamed to ${corruptPath}\n`);
  } catch {
    // Best-effort: if rename fails, delete the corrupt file to avoid
    // persistent read errors on next load.
    try { unlinkSync(path); } catch { /* unrecoverable */ }
  }
}

/**
 * Save the vault atomically:
 * 1. Write to a temp file in the same directory.
 * 2. Rename temp → target (atomic on same filesystem).
 *
 * This prevents partial writes from corrupting the vault on crash/power loss.
 */
function saveVault(path: string, store: Map<string, string>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const obj: Record<string, string> = {};
  for (const [k, v] of store) {
    obj[k] = v;
  }

  // Write to temp file first
  const tmpName = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(tmpName, JSON.stringify(obj), { encoding: "utf8", flush: true });
    // Atomic rename on same filesystem
    renameSync(tmpName, path);
  } catch {
    // Clean up temp file on failure
    try { unlinkSync(tmpName); } catch { /* best-effort */ }
    throw new Error("Failed to persist vault: atomic write failed");
  }
}

// ── Backend factory ──

export function createWindowsDPAPIBackend(
  dpapi?: DPAPIProvider,
  vaultPath?: string,
): SecretBackend {
  const provider = dpapi ?? createWindowsDPAPIProvider();
  const path = vaultPath ?? defaultVaultPath();

  // Load persisted vault on creation
  const store = loadVault(path);

  // Smoke test on first use
  let smokePassed = false;
  let smokeError: string | undefined;

  async function runSmoke(): Promise<void> {
    if (smokePassed) return;
    try {
      const testValue = `dpapi-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const encrypted = await provider.protect(
        Buffer.from(testValue, "utf8"),
        "CurrentUser",
      );
      const decrypted = await provider.unprotect(encrypted, "CurrentUser");
      if (decrypted.toString("utf8") !== testValue) {
        throw new Error("DPAPI round-trip mismatch");
      }
      smokePassed = true;
    } catch (err) {
      smokeError =
        err instanceof Error ? err.message : "DPAPI smoke test failed";
      throw err;
    }
  }

  return {
    async get(ref: string): Promise<string | undefined> {
      await runSmoke();
      const encryptedHex = store.get(ref);
      if (!encryptedHex) return undefined;
      const decrypted = await provider.unprotect(
        Buffer.from(encryptedHex, "hex"),
        "CurrentUser",
      );
      return decrypted.toString("utf8");
    },

    async set(ref: string, value: string): Promise<void> {
      await runSmoke();
      const encrypted = await provider.protect(
        Buffer.from(value, "utf8"),
        "CurrentUser",
      );
      store.set(ref, encrypted.toString("hex"));
      saveVault(path, store);
    },

    delete(ref: string): Promise<void> {
      store.delete(ref);
      saveVault(path, store);
      return Promise.resolve();
    },

    describe(ref: string): Promise<{ configured: boolean }> {
      return Promise.resolve({ configured: store.has(ref) });
    },

    async health(): Promise<SecretBackendStatus> {
      try {
        await runSmoke();
        return { available: true, backend: "dpapi" };
      } catch {
        return {
          available: false,
          backend: "none",
          reason: smokeError ?? "DPAPI is not available on this system",
        };
      }
    },
  };
}
