/** Windows CurrentUser DPAPI vault with atomic, ACL-verified publication. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { SestinaError } from "@sestina/schema";
import type {
  DPAPIProvider,
  SecretBackend,
  SecretBackendStatus,
} from "./port.js";
import { throwCorruption, throwUnavailable } from "./errors.js";
import { sanitizeArgs } from "./secret-scanner.js";
import { registerControlTokenCoordination } from "./control-token.js";

export interface VaultIO {
  load(path: string): Map<string, string>;
  save(
    path: string,
    store: Map<string, string>,
    secureCandidate: (candidatePath: string) => void,
  ): void;
}

export interface ACLProvider {
  applyACL(path: string): boolean;
  verifyACL(path: string): boolean;
  applyACLToDir(path: string): void;
}

function defaultVaultPath(): string {
  const base = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? homedir();
  return `${base}/Sestina/secrets/vault.json`;
}

interface DPAPINative {
  isPlatformSupported: boolean;
  Dpapi: {
    protectData(
      data: Uint8Array,
      entropy: Uint8Array | null,
      scope: "CurrentUser" | "LocalMachine",
    ): Uint8Array;
    unprotectData(
      data: Uint8Array,
      entropy: Uint8Array | null,
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
    const Dpapi = native.Dpapi ?? native.default?.Dpapi;
    if (
      !(native.isPlatformSupported ?? native.default?.isPlatformSupported) ||
      !Dpapi
    ) {
      loadError = "DPAPI platform not supported";
      return null;
    }
    dpapiNative = { isPlatformSupported: true, Dpapi };
    return dpapiNative;
  } catch {
    loadError = "DPAPI native module failed to load";
    return null;
  }
}

function guardScope(scope: string): asserts scope is "CurrentUser" {
  if (scope !== "CurrentUser")
    throw new Error("Only CurrentUser scope is supported.");
}

export function createWindowsDPAPIProvider(): DPAPIProvider {
  return {
    async protect(data, scope) {
      guardScope(scope);
      const native = await getDPAPI();
      if (!native) throwUnavailable("protect", loadError);
      try {
        return Buffer.from(native.Dpapi.protectData(data, null, scope));
      } catch (error) {
        throwUnavailable("protect", error);
      }
    },
    async unprotect(data, scope) {
      guardScope(scope);
      const native = await getDPAPI();
      if (!native) throwUnavailable("unprotect", loadError);
      try {
        return Buffer.from(native.Dpapi.unprotectData(data, null, scope));
      } catch (error) {
        throwUnavailable("unprotect", error);
      }
    },
  };
}

function quarantineCorruptVault(path: string): never {
  if (existsSync(path)) {
    let candidate = `${path}.corrupt`;
    let suffix = 1;
    while (existsSync(candidate) && suffix <= 1000) {
      candidate = `${path}.corrupt.${suffix}`;
      suffix += 1;
    }
    if (existsSync(candidate))
      throwCorruption("corruption archive limit reached");
    try {
      renameSync(path, candidate);
    } catch {
      throwCorruption("corrupt vault could not be preserved");
    }
  }
  throwCorruption("invalid vault record");
}

function defaultVaultLoad(path: string): Map<string, string> {
  if (!existsSync(path)) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return quarantineCorruptVault(path);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return quarantineCorruptVault(path);
  }

  const store = new Map<string, string>();
  for (const [ref, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (
      ref.length === 0 ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.length % 2 !== 0 ||
      !/^[0-9a-fA-F]+$/.test(value)
    ) {
      return quarantineCorruptVault(path);
    }
    store.set(ref, value);
  }
  return store;
}

function defaultVaultSave(
  path: string,
  store: Map<string, string>,
  secureCandidate: (candidatePath: string) => void,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const object: Record<string, string> = {};
  for (const [ref, value] of store) object[ref] = value;

  const candidate = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(candidate, JSON.stringify(object), {
      encoding: "utf8",
      flush: true,
    });
    try {
      chmodSync(candidate, 0o600);
    } catch {
      /* Windows DACL is authoritative. */
    }
    secureCandidate(candidate);
    renameSync(candidate, path);
  } catch (error) {
    try {
      unlinkSync(candidate);
    } catch {
      /* Candidate may already be gone. */
    }
    if (error instanceof SestinaError) throw error;
    throwCorruption("atomic vault publication failed");
  }
}

const defaultVaultIO: VaultIO = {
  load: defaultVaultLoad,
  save: defaultVaultSave,
};

/**
 * The desktop runtime is the sole process-level writer, but factories may be
 * instantiated more than once inside that process. Serialize publications by
 * canonical vault path and always merge against the latest disk snapshot.
 */
const vaultQueues = new Map<string, Promise<void>>();

function vaultLockKey(path: string): string {
  const canonical = resolve(path);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

async function withVaultLock<T>(
  path: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const key = vaultLockKey(path);
  const previous = vaultQueues.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.then(() => gate);
  vaultQueues.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (vaultQueues.get(key) === tail) vaultQueues.delete(key);
  }
}

function resolveUserSID(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const systemRoot =
      process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const executable = `${systemRoot}/System32/whoami.exe`;
    const args = sanitizeArgs([executable, "/user"]);
    const command = args[0];
    if (!command) return null;
    const output = execFileSync(command, args.slice(1), {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString("utf8");
    return /S-1-5-\d+(?:-\d+)+/.exec(output)?.[0] ?? null;
  } catch {
    return null;
  }
}

function isCurrentUserOnlyDacl(savedAcl: string, sid: string): boolean {
  const dacl = /D:([^\r\n]+)/.exec(savedAcl)?.[1];
  if (!dacl) return false;
  const flags = dacl.slice(0, Math.max(0, dacl.indexOf("(")));
  if (!flags.includes("P")) return false;

  const aces = [...dacl.matchAll(/\(([^)]*)\)/g)].map((match) =>
    (match[1] ?? "").split(";"),
  );
  if (aces.length === 0) return false;

  let hasFullAccess = false;
  for (const ace of aces) {
    const type = ace[0];
    const rights = ace[2];
    const trustee = ace[5];
    if (trustee !== sid) return false;
    if (type === "A" && rights === "FA") hasFullAccess = true;
  }
  return hasFullAccess;
}

function readSavedAcl(path: string, sid: string): boolean {
  const dump = `${path}.acl-${randomBytes(8).toString("hex")}`;
  try {
    const args = sanitizeArgs([path, "/save", dump, "/L", "/Q"]);
    execFileSync("icacls", args, {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return isCurrentUserOnlyDacl(readFileSync(dump, "utf16le"), sid);
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(dump);
    } catch {
      /* Nothing to clean. */
    }
  }
}

function realApplyACL(path: string): boolean {
  if (process.platform !== "win32" || !existsSync(path)) return false;
  const sid = resolveUserSID();
  if (!sid) return false;
  try {
    const args = sanitizeArgs([
      path,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:F`,
    ]);
    execFileSync("icacls", args, {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readSavedAcl(path, sid);
  } catch {
    return false;
  }
}

function realVerifyACL(path: string): boolean {
  if (process.platform !== "win32" || !existsSync(path)) return false;
  const sid = resolveUserSID();
  return sid !== null && readSavedAcl(path, sid);
}

function realApplyACLToDir(path: string): void {
  if (process.platform !== "win32" || !existsSync(path)) return;
  const sid = resolveUserSID();
  if (!sid) return;
  try {
    const args = sanitizeArgs([
      path,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:(OI)(CI)F`,
    ]);
    execFileSync("icacls", args, {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Directory hardening is defense-in-depth; file publication remains fail-closed.
  }
}

const defaultACL: ACLProvider = {
  applyACL: realApplyACL,
  verifyACL: realVerifyACL,
  applyACLToDir: realApplyACLToDir,
};

export function applyCurrentUserACL(vaultPath: string): boolean {
  return defaultACL.applyACL(vaultPath);
}

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

  function loadVerifiedVault(): Map<string, string> {
    if (existsSync(path) && !aclProvider.verifyACL(path)) {
      throwUnavailable("existing vault CurrentUser ACL verification failed");
    }
    return io.load(path);
  }

  let store = loadVerifiedVault();
  let smokePassed = false;
  let smokeError: string | undefined;

  async function runSmoke(): Promise<void> {
    if (smokePassed) return;
    try {
      const plaintext = Buffer.from(randomBytes(32).toString("hex"), "utf8");
      const encrypted = await provider.protect(plaintext, "CurrentUser");
      const decrypted = await provider.unprotect(encrypted, "CurrentUser");
      if (!decrypted.equals(plaintext))
        throw new Error("DPAPI round-trip mismatch");
      smokePassed = true;
    } catch (error) {
      smokeError = "DPAPI smoke test failed";
      throwUnavailable("smoke-test", error);
    }
  }

  function publish(next: Map<string, string>): void {
    io.save(path, next, (candidatePath) => {
      if (!aclProvider.applyACL(candidatePath)) {
        throwUnavailable("CurrentUser ACL verification failed");
      }
    });
    store = next;
    aclProvider.applyACLToDir(dirname(path));
  }

  function refresh(): Map<string, string> {
    store = loadVerifiedVault();
    return store;
  }

  async function requireReadable(
    encrypted: string,
    operation: string,
  ): Promise<string> {
    try {
      return (
        await provider.unprotect(Buffer.from(encrypted, "hex"), "CurrentUser")
      ).toString("utf8");
    } catch (error) {
      throwUnavailable(operation, error);
    }
  }

  const backend: SecretBackend = {
    async get(ref) {
      await runSmoke();
      const encrypted = refresh().get(ref);
      if (!encrypted) return undefined;
      return requireReadable(encrypted, "unprotect stored secret");
    },
    async set(ref, value) {
      await runSmoke();
      let encrypted: Buffer;
      try {
        encrypted = await provider.protect(
          Buffer.from(value, "utf8"),
          "CurrentUser",
        );
      } catch (error) {
        throwUnavailable("protect", error);
      }
      await withVaultLock(path, async () => {
        const next = new Map(loadVerifiedVault());
        const existing = next.get(ref);
        if (existing) await requireReadable(existing, "verify stored secret");
        next.set(ref, encrypted.toString("hex"));
        publish(next);
      });
    },
    async delete(ref) {
      await runSmoke();
      await withVaultLock(path, async () => {
        const next = new Map(loadVerifiedVault());
        const existing = next.get(ref);
        if (!existing) {
          store = next;
          return;
        }
        await requireReadable(existing, "verify secret before delete");
        next.delete(ref);
        publish(next);
      });
    },
    async describe(ref) {
      const encrypted = refresh().get(ref);
      if (!encrypted) return { configured: false };
      try {
        await provider.unprotect(Buffer.from(encrypted, "hex"), "CurrentUser");
        return { configured: true };
      } catch {
        return { configured: false };
      }
    },
    async health(): Promise<SecretBackendStatus> {
      try {
        loadVerifiedVault();
        await runSmoke();
        return { available: true, backend: "dpapi" };
      } catch {
        return {
          available: false,
          backend: "none",
          reason: smokeError ?? "DPAPI unavailable",
        };
      }
    },
  };

  registerControlTokenCoordination(backend, "windows:current-user");
  return backend;
}

export const __test = {
  defaultVaultLoad,
  defaultVaultSave,
  isCurrentUserOnlyDacl,
  resolveUserSID,
};
