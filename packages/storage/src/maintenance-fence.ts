import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { validateLeaseTtlMs } from "./lease.js";

export const FENCE_FILE_NAME = ".sestina-maintenance.lock";
export const DEFAULT_FENCE_TTL_MS = 60_000;

export interface MaintenanceFenceState {
  token: string;
  scope: string;
  pid: number;
  startedAt: number;
  expiresAt: number;
}

export interface MaintenanceFenceOptions {
  /** Sestina data root the sentinel lives in (shared by all maintenance). */
  dataRoot: string;
  /** Diagnostic scope: migrations | restore | retention. */
  scope: string;
  ttlMs?: number;
}

/**
 * File-system maintenance fence: the single cross-process exclusion domain
 * for migrations, restore and retention (docs/17 §3.2, docs/22 Task 6).
 *
 * Unlike the in-database lock, the sentinel lives beside — not inside —
 * the target database, so it survives the database being replaced (restore renames
 * the whole file) and works even when the database is corrupted.
 *
 * Acquisition is O_EXCL-atomic; takeover of an expired/corrupted sentinel
 * is an atomic same-directory rename; every acquisition carries a unique
 * fencing token, so a stale holder's renew() throws stale_state and its
 * release() is a no-op (ABA-safe).
 */
export class MaintenanceFence {
  readonly token: string;
  private readonly dataRoot: string;
  private held = true;

  private constructor(dataRoot: string, token: string) {
    this.dataRoot = dataRoot;
    this.token = token;
  }

  private get path(): string {
    return join(this.dataRoot, FENCE_FILE_NAME);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  static async acquire(options: MaintenanceFenceOptions): Promise<MaintenanceFence> {
    const ttlMs = validateLeaseTtlMs(options.ttlMs ?? DEFAULT_FENCE_TTL_MS, "Maintenance fence ttlMs");
    const token = randomUUID();
    mkdirSync(options.dataRoot, { recursive: true });
    const path = join(options.dataRoot, FENCE_FILE_NAME);
    const payload = JSON.stringify({
      token,
      scope: options.scope,
      pid: process.pid,
      startedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    } satisfies MaintenanceFenceState);

    for (let attempt = 0; ; attempt++) {
      try {
        const fd = openSync(path, "wx");
        try {
          writeFileSync(fd, payload, "utf8");
        } finally {
          closeSync(fd);
        }
        return new MaintenanceFence(options.dataRoot, token);
      } catch (err) {
        if (!isFsCode(err, "EEXIST")) {
          throw mapFsError(err, "Failed to acquire the maintenance fence");
        }
        const current = readFence(path);
        if (current !== undefined && current.expiresAt > Date.now()) {
          throw new SestinaError(
            SestinaErrorCode.storage_busy,
            "Maintenance fence is held by another owner",
          );
        }
        // Expired or corrupted sentinel: atomic takeover via rename.
        const takeover = `${path}.takeover-${token}`;
        try {
          const tmpFd = openSync(takeover, "wx");
          try {
            writeFileSync(tmpFd, payload, "utf8");
          } finally {
            closeSync(tmpFd);
          }
          renameSync(takeover, path);
          return new MaintenanceFence(options.dataRoot, token);
        } catch (takeoverErr) {
          rmSync(takeover, { force: true });
          if (attempt < 3 && isFsCode(takeoverErr, "EPERM")) {
            sleepSync(40);
            continue;
          }
          if (isFsCode(takeoverErr, "EEXIST") || isFsCode(takeoverErr, "EPERM")) {
            throw new SestinaError(
              SestinaErrorCode.storage_busy,
              "Maintenance fence is held by another owner",
            );
          }
          throw mapFsError(takeoverErr, "Failed to take over the maintenance fence");
        }
      }
    }
  }

  /** Reads the current sentinel state, if any. */
  static peek(dataRoot: string): MaintenanceFenceState | undefined {
    return readFence(join(dataRoot, FENCE_FILE_NAME));
  }

  /** Binds an instance to an existing token (used by stale-holder recovery). */
  static attach(dataRoot: string, token: string): MaintenanceFence {
    return new MaintenanceFence(dataRoot, token);
  }

  /** Extends the fence. Throws stale_state when this token no longer owns it. */
  renew(ttlMs?: number): void {
    this.assertHeld();
    const validated = validateLeaseTtlMs(ttlMs ?? DEFAULT_FENCE_TTL_MS, "Maintenance fence ttlMs");
    const owned = readOwnedFence(this.path, this.token);
    if (owned === undefined) {
      this.held = false;
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "Maintenance fence is no longer held by this owner",
      );
    }
    const updated = JSON.stringify({
      ...owned,
      expiresAt: Date.now() + validated,
    } satisfies MaintenanceFenceState);
    // Atomic tmp+rename write; afterwards the token is re-verified so a
    // takeover that landed in the window is detected instead of masked.
    writeFenceAtomically(this.path, updated, this.token);
    const after = readFence(this.path);
    if (after?.token !== this.token) {
      this.held = false;
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "Maintenance fence was taken over while renewing",
      );
    }
  }

  /**
   * Releases the fence (idempotent). Token-guarded: a stale holder can
   * never delete the current holder's sentinel.
   */
  release(): void {
    if (!this.held) return;
    this.held = false;
    // Only delete a sentinel this token still owns: a takeover that landed
    // between the read and the rm is the residual window, never a stale
    // deletion of an unrelated holder.
    const current = readFence(this.path);
    if (current?.token !== this.token) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        rmSync(this.path, { force: true });
        return;
      } catch (err) {
        if (!isFsCode(err, "EPERM")) throw mapFsError(err, "Failed to release the maintenance fence");
        sleepSync(40);
      }
    }
    throw new SestinaError(
      SestinaErrorCode.storage_busy,
      "Failed to release the maintenance fence",
    );
  }

  private assertHeld(): void {
    if (!this.held) {
      throw new SestinaError(SestinaErrorCode.stale_state, "Maintenance fence is released");
    }
  }
}

function readOwnedFence(path: string, token: string): MaintenanceFenceState | undefined {
  const current = readFence(path);
  return current?.token === token ? current : undefined;
}

function readFence(path: string): MaintenanceFenceState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MaintenanceFenceState>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.scope !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.startedAt !== "number" ||
      typeof parsed.pid !== "number"
    ) {
      return undefined; // corrupted — treated as expired, take-overable
    }
    return parsed as MaintenanceFenceState;
  } catch {
    return undefined;
  }
}

/** Atomic same-directory write: temp file + rename (never delete+recreate). */
function writeFenceAtomically(path: string, content: string, token: string): void {
  const temp = `${path}.heartbeat-${token}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = openSync(temp, "wx");
      try {
        writeFileSync(fd, content, "utf8");
      } finally {
        closeSync(fd);
      }
      renameSync(temp, path);
      return;
    } catch (err) {
      rmSync(temp, { force: true });
      if (!isFsCode(err, "EPERM")) throw mapFsError(err, "Failed to update the maintenance fence");
      sleepSync(40);
    }
  }
  throw new SestinaError(
    SestinaErrorCode.storage_busy,
    "Failed to update the maintenance fence",
  );
}

function isFsCode(err: unknown, code: string): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === code
  );
}

/** Maps native fs errors to stable SestinaErrors without leaking OS text. */
export function mapFsError(err: unknown, message: string): SestinaError {
  if (err instanceof SestinaError) return err;
  if (isFsCode(err, "ENOENT")) {
    return new SestinaError(SestinaErrorCode.validation_failed, message);
  }
  if (isFsCode(err, "EEXIST") || isFsCode(err, "EINVAL")) {
    return new SestinaError(SestinaErrorCode.validation_failed, message);
  }
  if (isFsCode(err, "EPERM") || isFsCode(err, "EACCES") || isFsCode(err, "EBUSY")) {
    return new SestinaError(SestinaErrorCode.storage_busy, message);
  }
  return new SestinaError(SestinaErrorCode.internal_error, message);
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}
