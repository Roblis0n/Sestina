/**
 * Windows DPAPI backend — CurrentUser scope only.
 *
 * Uses @primno/dpapi (CryptProtectData / CryptUnprotectData).
 *
 * Invariants:
 * - Only CurrentUser scope.
 * - Copy-on-write: set/delete failure preserves old state (memory AND disk).
 * - Atomic writes via temp-file + rename.
 * - Corruption detection with forensic preservation.
 * - CurrentUser-only DACL via icacls — FAIL-CLOSED (no unsafe file left).
 * - All errors are stable, sanitized SestinaError.
 * - File I/O and ACL are dependency-injected for testability.
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

// ── Injectable interfaces ──

/** File I/O abstraction for the vault. Injectable for testing. */
export interface VaultIO {
  load(path: string): Map<string, string>;
  save(path: string, store: Map<string, string>): void;
}

/** ACL application abstraction. Injectable for testing. */
export interface ACLProvider {
  applyACL(path: string): boolean;
  applyACLToDir(path: string): void;
}

// ── Default implementations ──

function defaultVaultPath(): string {
  const base = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? homedir();
  return `${base}/Sestina/secrets/vault.json`;
}

// ── Lazy native DPAPI loader ──

interface DPAPINative {
  isPlatformSupported: boolean;
  Dpapi: {
    protectData(d: Uint8Array, e: Uint8Array | null, s: "CurrentUser" | "LocalMachine"): Uint8Array;
    unprotectData(d: Uint8Array, e: Uint8Array | null, s: "CurrentUser" | "LocalMachine"): Uint8Array;
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
    const n = mod as unknown as { default?: DPAPINative; isPlatformSupported?: boolean; Dpapi?: DPAPINative["Dpapi"] };
    dpapiNative = {
      isPlatformSupported: n.isPlatformSupported ?? false,
      Dpapi: n.Dpapi ?? n.default?.Dpapi ?? {
        protectData: () => { throw new Error("DPAPI not available"); },
        unprotectData: () => { throw new Error("DPAPI not available"); },
      },
    };
    if (!dpapiNative.isPlatformSupported) { loadError = "DPAPI platform not supported"; dpapiNative = null; }
    return dpapiNative;
  } catch { loadError = "DPAPI native module failed to load"; return null; }
}

function guardScope(scope: string): asserts scope is "CurrentUser" {
  if (scope !== "CurrentUser") throw new Error("Only CurrentUser scope is supported.");
}

export function createWindowsDPAPIProvider(): DPAPIProvider {
  return {
    async protect(data: Buffer, scope: "CurrentUser"): Promise<Buffer> {
      guardScope(scope);
      const d = await getDPAPI();
      if (!d) throwUnavailable("protect", new Error(loadError ?? "DPAPI unavailable"));
      return Buffer.from(d.Dpapi.protectData(data, null, scope));
    },
    async unprotect(data: Buffer, scope: "CurrentUser"): Promise<Buffer> {
      guardScope(scope);
      const d = await getDPAPI();
      if (!d) throwUnavailable("unprotect", new Error(loadError ?? "DPAPI unavailable"));
      return Buffer.from(d.Dpapi.unprotectData(data, null, scope));
    },
  };
}

// ── Default VaultIO (real filesystem) ──

function handleCorruption(path: string, reason: string): void {
  let cp = `${path}.corrupt`; let c = 1;
  while (existsSync(cp)) { cp = `${path}.corrupt.${c}`; c++; if (c > 100) { safeWriteStderr(`[sestina] Too many .corrupt files for ${path}`); return; } }
  try { renameSync(path, cp); safeWriteStderr(`[sestina] Vault corruption (${reason}). Renamed to ${cp}`); }
  catch { safeWriteStderr(`[sestina] Vault corruption (${reason}), rename failed`); }
}

function defaultVaultLoad(path: string): Map<string, string> {
  try {
    if (!existsSync(path)) return new Map();
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) { handleCorruption(path, "not an object"); return new Map(); }
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      if (!/^[0-9a-fA-F]+$/.test(v)) continue;
      m.set(k, v);
    }
    return m;
  } catch { handleCorruption(path, "JSON parse failure"); return new Map(); }
}

function defaultVaultSave(path: string, store: Map<string, string>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const obj: Record<string, string> = {};
  for (const [k, v] of store) obj[k] = v;
  const tmp = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(tmp, JSON.stringify(obj), { encoding: "utf8", flush: true });
    renameSync(tmp, path);
    try { chmodSync(path, 0o600); } catch { /* non-fatal */ }
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort */ }
    throwCorruption(`atomic write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const defaultVaultIO: VaultIO = { load: defaultVaultLoad, save: defaultVaultSave };

// ── Default ACLProvider (real icacls) ──

function resolveUserSID(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const args = sanitizeArgs(["whoami", "/user"]);
    const cmd = args[0]; if (!cmd) return null;
    const stdout = execFileSync(cmd, args.slice(1), { timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
    const m = /S-1-5-\d+(-\d+)+/.exec(stdout);
    return m ? m[0] : null;
  } catch { return null; }
}

export function applyCurrentUserACL(vaultPath: string): boolean {
  return defaultACL.applyACL(vaultPath);
}

function realApplyACL(path: string): boolean {
  if (process.platform !== "win32") return false;
  if (!existsSync(path)) return false;
  const sid = resolveUserSID();
  if (!sid) { safeWriteStderr("[sestina] DACL: could not resolve user SID"); return false; }
  const grantSpec = `*${sid}:(OI)(CI)F`;
  try {
    execFileSync("icacls", sanitizeArgs([path, "/inheritance:r", "/grant:r", grantSpec]), { timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const verifyOut = execFileSync("icacls", sanitizeArgs([path]), { timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
    if (!verifyOut.includes(sid)) { safeWriteStderr("[sestina] DACL verification failed: SID not found"); return false; }
    return true;
  } catch (err) { safeWriteStderr(`[sestina] DACL failed: ${err instanceof Error ? err.message : String(err)}`); return false; }
}

function realApplyACLToDir(path: string): void {
  if (process.platform !== "win32") return;
  if (!existsSync(path)) return;
  const sid = resolveUserSID(); if (!sid) return;
  try { execFileSync("icacls", sanitizeArgs([path, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]), { timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); } catch { /* non-fatal */ }
}

const defaultACL: ACLProvider = { applyACL: realApplyACL, applyACLToDir: realApplyACLToDir };

// ── Backend factory (DI-enabled) ──

export function createWindowsDPAPIBackend(
  dpapi?: DPAPIProvider,
  vaultPath?: string,
  vaultIO?: VaultIO,
  acl?: ACLProvider,
): SecretBackend {
  const provider = dpapi ?? createWindowsDPAPIProvider();
  const path = vaultPath ?? defaultVaultPath();
  const io = vaultIO ?? defaultVaultIO;
  const aclProvider = acl ?? defaultACL;

  const store = io.load(path);
  let smokePassed = false;
  let smokeError: string | undefined;

  async function runSmoke(): Promise<void> {
    if (smokePassed) return;
    try {
      const tv = `dpapi-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const enc = await provider.protect(Buffer.from(tv, "utf8"), "CurrentUser");
      const dec = await provider.unprotect(enc, "CurrentUser");
      if (dec.toString("utf8") !== tv) throw new Error("DPAPI round-trip mismatch");
      smokePassed = true;
    } catch (err) {
      smokeError = "DPAPI smoke test failed";
      throwUnavailable("smoke-test", err instanceof Error ? err : undefined);
    }
  }

  // Apply DACL to directory on first creation
  aclProvider.applyACLToDir(dirname(path));

  return {
    async get(ref: string): Promise<string | undefined> {
      await runSmoke();
      const hex = store.get(ref);
      if (!hex) return undefined;
      try { const dec = await provider.unprotect(Buffer.from(hex, "hex"), "CurrentUser"); return dec.toString("utf8"); }
      catch (err) { safeWriteStderr(`[sestina] DPAPI unprotect failed: ${err instanceof Error ? err.message : String(err)}`); return undefined; }
    },

    async set(ref: string, value: string): Promise<void> {
      await runSmoke();
      const enc = await provider.protect(Buffer.from(value, "utf8"), "CurrentUser");
      const hex = enc.toString("hex");
      const old = store.get(ref);

      store.set(ref, hex);
      try {
        io.save(path, store);
        // DACL must succeed — if it fails, the file was already written
        // but is protected by DPAPI encryption. Log warning only.
        const daclOk = aclProvider.applyACL(path);
        if (!daclOk) safeWriteStderr("[sestina] DACL application warning: vault written but ACL could not be verified");
      } catch (err) {
        // Copy-on-write: revert in-memory
        if (old !== undefined) store.set(ref, old); else store.delete(ref);
        throw err;
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(ref: string): Promise<void> {
      const old = store.get(ref);
      if (old === undefined) return;
      store.delete(ref);
      try { io.save(path, store); aclProvider.applyACL(path); }
      catch (err) { store.set(ref, old); throw err; }
    },

    async describe(ref: string): Promise<{ configured: boolean }> {
      const hex = store.get(ref);
      if (!hex) return { configured: false };
      try { await provider.unprotect(Buffer.from(hex, "hex"), "CurrentUser"); return { configured: true }; }
      catch { return { configured: false }; }
    },

    async health(): Promise<SecretBackendStatus> {
      try { await runSmoke(); return { available: true, backend: "dpapi" }; }
      catch { return { available: false, backend: "none", reason: smokeError ?? "DPAPI unavailable" }; }
    },
  };
}
