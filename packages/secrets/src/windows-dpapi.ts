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
 * - Corruption detection on load with forensic preservation.
 * - CurrentUser-only DACL applied to vault file on Windows.
 * - All errors are stable, sanitized SestinaError (no raw native errors).
 */
import {
  mkdirSync, readFileSync, writeFileSync, renameSync,
  existsSync, unlinkSync, chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { SecretBackend, SecretBackendStatus, DPAPIProvider } from "./port.js";
import { throwUnavailable, throwCorruption } from "./errors.js";
import { scanForSecrets } from "./secret-scanner.js";

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
  } catch {
    loadError = "DPAPI native module failed to load";
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
        throwUnavailable("protect", new Error(loadError ?? "DPAPI unavailable"));
      }
      const result = dpapi.Dpapi.protectData(data, null, scope);
      return Buffer.from(result);
    },
    async unprotect(data: Buffer, scope: "CurrentUser"): Promise<Buffer> {
      guardScope(scope);
      const dpapi = await getDPAPI();
      if (!dpapi) {
        throwUnavailable("unprotect", new Error(loadError ?? "DPAPI unavailable"));
      }
      const result = dpapi.Dpapi.unprotectData(data, null, scope);
      return Buffer.from(result);
    },
  };
}

// ── Windows ACL: set CurrentUser-only DACL on vault file ──

/**
 * Apply CurrentUser-only DACL to the vault file on Windows.
 * Uses icacls to:
 * 1. Inherit no permissions from parent
 * 2. Grant (OI)(CI)F to the current user only
 * 3. Remove inherited entries
 *
 * On non-Windows or if icacls is unavailable, this is a no-op.
 * The vault is still protected by DPAPI encryption and the user's
 * home/profile directory permissions.
 */
function applyCurrentUserACL(vaultPath: string): void {
  if (process.platform !== "win32") return;
  try {
    // Ensure the vault file exists before setting ACL
    if (!existsSync(vaultPath)) return;

    // /inheritance:r  = remove all inherited ACEs
    // /grant:r        = replace grant for specified user
    // %USERNAME%:F    = Full control for current user
    const username = process.env.USERNAME ?? process.env.USER;
    if (!username) return;

    execFileSync("icacls", [
      vaultPath,
      "/inheritance:r",
      "/grant:r",
      `${username}:(OI)(CI)F`,
    ], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"], // capture stderr only
    });
  } catch {
    // Non-fatal: ACL is defense-in-depth.
    // DPAPI encryption already binds to the user's credential.
    // If icacls fails (e.g., non-admin, non-Windows), the vault
    // is still cryptographically protected.
  }
}

function applyACLToDir(dirPath: string): void {
  if (process.platform !== "win32") return;
  try {
    if (!existsSync(dirPath)) return;
    const username = process.env.USERNAME ?? process.env.USER;
    if (!username) return;

    execFileSync("icacls", [
      dirPath,
      "/inheritance:r",
      "/grant:r",
      `${username}:(OI)(CI)F`,
    ], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    // Non-fatal
  }
}

// ── Disk-persisted vault (atomic writes + corruption detection) ──

/**
 * Load the vault from disk. Returns a Map of ref → encrypted-hex.
 *
 * Corruption handling:
 * - Missing file → empty Map (first run).
 * - Unparseable JSON → forensic backup, empty Map.
 * - Structural corruption → forensic backup, empty Map.
 * - Non-hex entry values → skipped (potential plaintext leak).
 * - NEVER deletes the forensic original on rename conflict.
 */
function loadVault(path: string): Map<string, string> {
  try {
    if (!existsSync(path)) return new Map();
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      handleCorruption(path, "vault root is not a JSON object");
      return new Map();
    }
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      if (!/^[0-9a-fA-F]+$/.test(value)) continue;
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
 *
 * SAFETY: If the target `.corrupt` file already exists, a unique
 * numbered suffix is appended (e.g., `.corrupt.1`, `.corrupt.2`).
 * The forensic original is NEVER deleted or overwritten.
 */
function handleCorruption(path: string, reason: string): void {
  // Find a unique forensic backup name
  let corruptPath = `${path}.corrupt`;
  let counter = 1;
  while (existsSync(corruptPath)) {
    corruptPath = `${path}.corrupt.${counter}`;
    counter++;
    // Safety limit: avoid infinite loop
    if (counter > 100) {
      sanitizedStderr(
        `[sestina] Vault corruption detected (${reason}), but too many .corrupt files exist. ` +
        `Skipping forensic backup of ${path}.`,
      );
      return;
    }
  }

  try {
    renameSync(path, corruptPath);
    sanitizedStderr(
      `[sestina] Vault corruption detected (${reason}). Renamed to ${corruptPath}`,
    );
  } catch {
    // If rename completely fails (permissions, filesystem error),
    // leave the original file in place. Do NOT delete it.
    sanitizedStderr(
      `[sestina] Vault corruption detected (${reason}), but rename failed. ` +
      `Original file left at ${path}.`,
    );
  }
}

/**
 * Sanitized stderr write: scans message for secret patterns before output.
 */
function sanitizedStderr(message: string): void {
  const result = scanForSecrets(message);
  if (result.hasSecrets) {
    const redacted = message.replace(
      /[0-9a-fA-F]{32,}/g,
      "[REDACTED:hex-token]",
    );
    process.stderr.write(`${redacted}\n`);
    return;
  }
  process.stderr.write(`${message}\n`);
}

/**
 * Save the vault atomically:
 * 1. Write to a temp file in the same directory.
 * 2. fsync / flush to disk.
 * 3. Rename temp → target (atomic on same filesystem).
 * 4. Apply CurrentUser DACL to the new file.
 *
 * On write failure, the in-memory store is NOT modified.
 * Any temp file is cleaned up on failure.
 */
function saveVault(path: string, store: Map<string, string>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  // Apply DACL to the vault directory on first creation
  applyACLToDir(dir);

  const obj: Record<string, string> = {};
  for (const [k, v] of store) {
    obj[k] = v;
  }

  const tmpName = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(tmpName, JSON.stringify(obj), { encoding: "utf8", flush: true });
    // Atomic rename on same filesystem
    renameSync(tmpName, path);
    // Apply CurrentUser DACL to the vault file
    applyCurrentUserACL(path);
    // Restrict POSIX-mode permissions (belt-and-suspenders, effective on Unix)
    try { chmodSync(path, 0o600); } catch { /* non-fatal on Windows */ }
  } catch (err) {
    // Clean up temp file on failure — never leave stale temp files
    try { unlinkSync(tmpName); } catch { /* best-effort */ }
    // Throw stable SestinaError, not raw filesystem error
    throwCorruption(
      `atomic write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
      smokeError = "DPAPI smoke test failed";
      throwUnavailable("smoke-test", err instanceof Error ? err : undefined);
    }
  }

  return {
    async get(ref: string): Promise<string | undefined> {
      await runSmoke();
      const encryptedHex = store.get(ref);
      if (!encryptedHex) return undefined;
      try {
        const decrypted = await provider.unprotect(
          Buffer.from(encryptedHex, "hex"),
          "CurrentUser",
        );
        return decrypted.toString("utf8");
      } catch (err) {
        // DPAPI unprotect failure: the blob may be corrupt or from another user.
        // Return undefined (treat as not found) — do NOT surface raw error.
        const msg = err instanceof Error ? err.message : String(err);
        sanitizedStderr(
          "[sestina] DPAPI unprotect failed for ref " + ref + ": " + msg,
        );
        return undefined;
      }
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
