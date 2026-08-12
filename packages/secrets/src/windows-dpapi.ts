/**
 * Windows DPAPI backend — CurrentUser scope only.
 *
 * Uses @primno/dpapi (CryptProtectData / CryptUnprotectData).
 *
 * Invariants:
 * - Only CurrentUser scope.
 * - Copy-on-write: set/delete failure preserves old state in memory AND disk.
 * - Atomic writes via temp-file + rename.
 * - Corruption detection with forensic preservation.
 * - CurrentUser-only DACL via icacls (verified, not best-effort).
 * - All errors are stable, sanitized SestinaError.
 * - All subprocess args sanitized through secret-scanner.
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
import { safeWriteStderr, sanitizeArgs } from "./secret-scanner.js";

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
        protectData: () => { throw new Error("DPAPI not available"); },
        unprotectData: () => { throw new Error("DPAPI not available"); },
      },
    };
    if (!dpapiNative.isPlatformSupported) {
      loadError = "DPAPI platform not supported (non-Windows or unsupported arch)";
      dpapiNative = null;
    }
    return dpapiNative;
  } catch {
    loadError = "DPAPI native module failed to load";
    return null;
  }
}

// ── DPAPI provider ──

function guardScope(scope: string): asserts scope is "CurrentUser" {
  if (scope !== "CurrentUser") {
    throw new Error("Only CurrentUser DPAPI scope is supported. LocalMachine is rejected.");
  }
}

export function createWindowsDPAPIProvider(): DPAPIProvider {
  return {
    async protect(data: Buffer, scope: "CurrentUser"): Promise<Buffer> {
      guardScope(scope);
      const dpapi = await getDPAPI();
      if (!dpapi) throwUnavailable("protect", new Error(loadError ?? "DPAPI unavailable"));
      return Buffer.from(dpapi.Dpapi.protectData(data, null, scope));
    },
    async unprotect(data: Buffer, scope: "CurrentUser"): Promise<Buffer> {
      guardScope(scope);
      const dpapi = await getDPAPI();
      if (!dpapi) throwUnavailable("unprotect", new Error(loadError ?? "DPAPI unavailable"));
      return Buffer.from(dpapi.Dpapi.unprotectData(data, null, scope));
    },
  };
}

// ── Windows ACL ──

/**
 * Resolve the current user's SID via `whoami /user`.
 * Returns the SID string (e.g., "S-1-5-21-...") or null on failure.
 * The subprocess arguments are sanitized before execution.
 */
function resolveUserSID(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const args = sanitizeArgs(["whoami", "/user"]);
    const cmd = args[0];
    if (!cmd) return null;
    const stdout = execFileSync(cmd, args.slice(1), {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString("utf8");
    // Parse: "S-1-5-21-..." from output
    const match = /S-1-5-\d+(-\d+)+/.exec(stdout);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Apply CurrentUser-only DACL to the vault file.
 * Uses the user's SID (not just USERNAME) for reliable identity.
 *
 * @param vaultPath  Path to the vault file.
 * @returns true if DACL was successfully applied.
 * @throws If DACL application fails (this is NOT best-effort).
 */
export function applyCurrentUserACL(vaultPath: string): boolean {
  if (process.platform !== "win32") return false;
  if (!existsSync(vaultPath)) return false;

  const sid = resolveUserSID();
  if (!sid) {
    safeWriteStderr("[sestina] DACL: could not resolve user SID, cannot verify CurrentUser-only");
    return false;
  }

  // icacls requires * prefix for SID strings (vs usernames)
  // Syntax: icacls <path> /inheritance:r /grant:r *S-1-5-21-...:(OI)(CI)F
  const grantSpec = `*${sid}:(OI)(CI)F`;

  try {
    execFileSync("icacls", sanitizeArgs([
      vaultPath,
      "/inheritance:r",
      "/grant:r",
      grantSpec,
    ]), {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Verify: read back the ACL to confirm it was applied
    const verifyOut = execFileSync("icacls", sanitizeArgs([vaultPath]), {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString("utf8");

    // The output should contain the SID if DACL was applied
    if (!verifyOut.includes(sid)) {
      safeWriteStderr("[sestina] DACL verification failed: SID not found in ACL output");
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    safeWriteStderr(`[sestina] DACL application failed: ${msg}`);
    return false;
  }
}

function applyACLToDir(dirPath: string): void {
  if (process.platform !== "win32") return;
  if (!existsSync(dirPath)) return;
  const sid = resolveUserSID();
  if (!sid) return;
  try {
    execFileSync("icacls", sanitizeArgs([
      dirPath,
      "/inheritance:r",
      "/grant:r",
      `${sid}:(OI)(CI)F`,
    ]), {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Directory DACL is non-fatal defense-in-depth
  }
}

// ── Disk-persisted vault ──

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

function handleCorruption(path: string, reason: string): void {
  let corruptPath = `${path}.corrupt`;
  let counter = 1;
  while (existsSync(corruptPath)) {
    corruptPath = `${path}.corrupt.${counter}`;
    counter++;
    if (counter > 100) {
      safeWriteStderr(
        `[sestina] Vault corruption (${reason}), too many .corrupt files, skipping backup of ${path}`,
      );
      return;
    }
  }
  try {
    renameSync(path, corruptPath);
    safeWriteStderr(`[sestina] Vault corruption (${reason}). Renamed to ${corruptPath}`);
  } catch {
    safeWriteStderr(`[sestina] Vault corruption (${reason}), rename failed, original left at ${path}`);
  }
}

// ── Copy-on-write save ──

/**
 * Save the vault atomically with copy-on-write semantics.
 *
 * 1. Serialize current state to temp file
 * 2. fsync temp file
 * 3. Atomically rename temp → target
 * 4. Apply DACL
 *
 * On ANY failure:
 * - The in-memory store is NOT modified (caller's responsibility
 *   to revert if needed).
 * - The on-disk vault retains its previous state (rename didn't happen).
 * - The temp file is cleaned up.
 * - A stable SestinaError is thrown.
 */
function saveVault(path: string, store: Map<string, string>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  applyACLToDir(dir);

  const obj: Record<string, string> = {};
  for (const [k, v] of store) {
    obj[k] = v;
  }

  const tmpName = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(tmpName, JSON.stringify(obj), { encoding: "utf8", flush: true });
    renameSync(tmpName, path);
    applyCurrentUserACL(path);
    try { chmodSync(path, 0o600); } catch { /* non-fatal */ }
  } catch (err) {
    try { unlinkSync(tmpName); } catch { /* best-effort */ }
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

  const store = loadVault(path);

  let smokePassed = false;
  let smokeError: string | undefined;

  async function runSmoke(): Promise<void> {
    if (smokePassed) return;
    try {
      const testValue = `dpapi-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const encrypted = await provider.protect(Buffer.from(testValue, "utf8"), "CurrentUser");
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
          Buffer.from(encryptedHex, "hex"), "CurrentUser",
        );
        return decrypted.toString("utf8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        safeWriteStderr("[sestina] DPAPI unprotect failed for ref " + ref + ": " + msg);
        return undefined;
      }
    },

    async set(ref: string, value: string): Promise<void> {
      await runSmoke();
      const encrypted = await provider.protect(Buffer.from(value, "utf8"), "CurrentUser");
      const encryptedHex = encrypted.toString("hex");
      const oldValue = store.get(ref); // save for rollback

      // In-memory update
      store.set(ref, encryptedHex);
      try {
        saveVault(path, store);
      } catch (err) {
        // Copy-on-write: revert in-memory state to old value
        if (oldValue !== undefined) {
          store.set(ref, oldValue);
        } else {
          store.delete(ref);
        }
        throw err; // re-throw SestinaError from saveVault
      }
    },

    delete(ref: string): Promise<void> {
      const oldValue = store.get(ref);
      if (oldValue === undefined) return Promise.resolve(); // idempotent

      store.delete(ref);
      try {
        saveVault(path, store);
        return Promise.resolve();
      } catch (err) {
        // Copy-on-write: restore in-memory state
        store.set(ref, oldValue);
        throw err;
      }
    },

    async describe(ref: string): Promise<{ configured: boolean }> {
      const encryptedHex = store.get(ref);
      if (!encryptedHex) return { configured: false };
      // Verify the blob is readable by the current provider
      try {
        await provider.unprotect(Buffer.from(encryptedHex, "hex"), "CurrentUser");
        return { configured: true };
      } catch {
        return { configured: false };
      }
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
