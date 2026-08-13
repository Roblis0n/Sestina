/**
 * Control token generation, storage, versioning, and rotation.
 *
 * Each control token is stored as a SINGLE ATOMIC RECORD containing
 * both the token value AND its version. This prevents split-brain
 * inconsistencies where the token and version could desynchronize.
 *
 * Record format (JSON):
 *   {"v": <number>, "t": "<64-char-hex>"}
 *
 * Migration: existing installations that store token and version as
 * separate backend keys are transparently migrated on first read.
 *
 * Invariants:
 * - Token + version always written atomically as one record.
 * - Version is always a positive finite safe integer.
 * - After reset, old token is IMMEDIATELY invalidated.
 * - The token proves "current OS user installed this client" ONLY.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { SecretBackend } from "./port.js";
import type { ControlToken, ControlTokenScope } from "./port.js";

// ── Constants ──

const TOKEN_BYTES = 32;
const TOKEN_HEX_LENGTH = 64;
/** Maximum allowed version value (prevents overflow attacks). */
const MAX_VERSION = Number.MAX_SAFE_INTEGER;

/**
 * SecretBackend does not expose a compare-and-swap primitive. The desktop
 * runtime is the sole writer, so serialize token mutations per backend/ref to
 * make get-or-create and reset linearizable inside the owning process.
 */
type BackendLockIdentity = SecretBackend | string;
const backendCoordinationKeys = new WeakMap<SecretBackend, string>();
const backendQueues = new Map<
  BackendLockIdentity,
  Map<string, Promise<void>>
>();

/** Register multiple adapters that address the same physical store. */
export function registerControlTokenCoordination(
  backend: SecretBackend,
  key: string,
): void {
  backendCoordinationKeys.set(backend, key);
}

async function withTokenLock<T>(
  backend: SecretBackend,
  ref: string,
  operation: () => Promise<T>,
): Promise<T> {
  const identity: BackendLockIdentity =
    backendCoordinationKeys.get(backend) ?? backend;
  let queues = backendQueues.get(identity);
  if (!queues) {
    queues = new Map<string, Promise<void>>();
    backendQueues.set(identity, queues);
  }

  const previous = queues.get(ref) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  queues.set(ref, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(ref) === tail) {
      queues.delete(ref);
      if (queues.size === 0) backendQueues.delete(identity);
    }
  }
}

// ── Ref key computation ──

function tokenRef(scope: ControlTokenScope): string {
  return `sestina/control-token/${scope}`;
}

function versionRef(scope: ControlTokenScope): string {
  return `sestina/control-token/${scope}/version`;
}

// ── Atomic record helpers ──

interface TokenRecord {
  v: number;
  t: string;
}

function packRecord(value: string, version: number): string {
  return JSON.stringify({ v: version, t: value });
}

function parseRecord(raw: string): TokenRecord | null {
  try {
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) return null;
    const rec = obj as Record<string, unknown>;
    if (typeof rec.v !== "number" || typeof rec.t !== "string") return null;
    if (!Number.isSafeInteger(rec.v) || rec.v < 1 || rec.v > MAX_VERSION)
      return null;
    if (rec.t.length !== TOKEN_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(rec.t))
      return null;
    return { v: rec.v, t: rec.t };
  } catch {
    return null;
  }
}

function corruptLegacyVersion(scope: ControlTokenScope): SestinaError {
  return new SestinaError(
    SestinaErrorCode.database_corrupt,
    `Control token for scope "${scope}" has an invalid legacy version. ` +
      "Remove the damaged token record and re-run setup.",
  );
}

function parseLegacyVersion(
  raw: string | undefined,
  scope: ControlTokenScope,
): number {
  if (raw === undefined) return 1;
  if (!/^\d+$/.test(raw)) throw corruptLegacyVersion(scope);
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1 || version > MAX_VERSION) {
    throw corruptLegacyVersion(scope);
  }
  return version;
}

// ── Token generation ──

function generateTokenValue(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

// ── Public API ──

/**
 * Get or create a versioned control token.
 *
 * Reads the atomic record first. If absent, tries the legacy
 * split-storage format (token and version as separate keys) and
 * migrates to the atomic format on success.
 */
export async function getOrCreateControlToken(
  backend: SecretBackend,
  scope: ControlTokenScope,
): Promise<ControlToken> {
  const ref = tokenRef(scope);
  const verRef = versionRef(scope);

  return withTokenLock(backend, ref, async () => {
    // Try atomic record first
    const raw = await backend.get(ref);
    if (raw !== undefined) {
      const parsed = parseRecord(raw);
      if (parsed) {
        return { ref, version: parsed.v, value: parsed.t };
      }
      // Not valid atomic JSON — could be legacy raw hex or corruption
      if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        // Legacy raw hex token at ref key: migrate to atomic
        const versionStr = await backend.get(verRef);
        const version = parseLegacyVersion(versionStr, scope);
        try {
          await backend.set(ref, packRecord(raw, version));
        } catch (error) {
          // A deliberately read-only environment backend can safely use a
          // pre-provisioned raw token. It cannot rewrite the caller's process
          // environment, so retain the validated value in place.
          if (
            error instanceof SestinaError &&
            error.code === SestinaErrorCode.secure_storage_unavailable
          ) {
            return { ref, version, value: raw };
          }
          throw error;
        }
        try {
          await backend.delete(verRef);
        } catch {
          /* best-effort */
        }
        return { ref, version, value: raw };
      }
      // Record exists but is corrupt — fail closed, never silently rebuild
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        `Control token for scope "${scope}" is corrupted. ` +
          `The stored record could not be parsed and is not a valid legacy token. ` +
          `Delete the key "${ref}" and re-run setup to regenerate.`,
      );
    }

    // No record at ref: try legacy split-storage (version key only)
    const versionStr = await backend.get(verRef);
    if (versionStr !== undefined) {
      parseLegacyVersion(versionStr, scope);
      // Legacy version exists but no token — corruption
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        `Control token for scope "${scope}" has legacy version key but no token value. ` +
          `Delete both "${ref}" and "${verRef}" and re-run setup.`,
      );
    }

    // First-time creation: write-then-verify to handle concurrent access
    const value = generateTokenValue();
    await backend.set(ref, packRecord(value, 1));
    // Re-read to check if a concurrent call wrote something different
    const final = await backend.get(ref);
    if (final !== undefined) {
      const parsed = parseRecord(final);
      if (parsed) return { ref, version: parsed.v, value: parsed.t };
    }
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      `Control token for scope "${scope}" could not be verified after storage.`,
    );
  });
}

/**
 * Explicitly rotate (reset) a control token.
 *
 * Writes the new token+version as a single atomic record.
 * The old token is immediately invalidated.
 *
 * @throws SestinaError if the backend write fails.
 */
export async function resetControlToken(
  backend: SecretBackend,
  scope: ControlTokenScope,
): Promise<ControlToken> {
  const ref = tokenRef(scope);
  const verRef = versionRef(scope);

  return withTokenLock(backend, ref, async () => {
    // Read current version from atomic record
    const raw = await backend.get(ref);
    let currentVersion = 0;
    let migratedLegacy = false;
    if (raw !== undefined) {
      const parsed = parseRecord(raw);
      if (parsed) {
        currentVersion = parsed.v;
      } else if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        currentVersion = parseLegacyVersion(await backend.get(verRef), scope);
        migratedLegacy = true;
      } else {
        // Corrupt record — fail closed, never overwrite
        throw new SestinaError(
          SestinaErrorCode.database_corrupt,
          `Control token for scope "${scope}" is corrupted and cannot be reset. ` +
            `Delete the key "${ref}" and re-run setup to regenerate.`,
        );
      }
    } else if ((await backend.get(verRef)) !== undefined) {
      throw new SestinaError(
        SestinaErrorCode.database_corrupt,
        `Control token for scope "${scope}" has a legacy version but no token.`,
      );
    }

    // Guard against version overflow
    if (currentVersion >= MAX_VERSION) {
      throw new SestinaError(
        SestinaErrorCode.limit_exceeded,
        "Control token version cannot be incremented safely.",
      );
    }

    const newVersion = currentVersion + 1;
    const newValue = generateTokenValue();

    // Atomic write: token + version in one record
    await backend.set(ref, packRecord(newValue, newVersion));
    if (migratedLegacy) {
      try {
        await backend.delete(verRef);
      } catch {
        /* stale metadata is ignored */
      }
    }

    return { ref, version: newVersion, value: newValue };
  });
}

// ── Challenge verification ──

export async function verifyChallengeResponse(
  backend: SecretBackend,
  scope: ControlTokenScope,
  expectedHMAC: Buffer,
  nonceClient: Buffer,
  nonceServer: Buffer,
  role: string,
): Promise<boolean> {
  const ref = tokenRef(scope);

  const raw = await backend.get(ref);
  if (!raw) return false;

  const parsed = parseRecord(raw);
  const currentValue = parsed?.t ?? raw; // tolerate legacy raw-hex format
  if (!/^[0-9a-fA-F]{64}$/.test(currentValue)) return false;

  const { createHmac } = await import("node:crypto");
  const message = Buffer.concat([nonceClient, nonceServer, Buffer.from(role)]);

  const key = Buffer.from(currentValue, "hex");
  if (key.length !== TOKEN_BYTES) return false;
  const expected = createHmac("sha256", key).update(message).digest();
  if (expected.length !== expectedHMAC.length) return false;

  return timingSafeEqual(expected, expectedHMAC);
}

// ── Export helpers for testing ──

export const __test = {
  TOKEN_BYTES,
  TOKEN_HEX_LENGTH,
  MAX_VERSION,
  tokenRef,
  versionRef,
  packRecord,
  parseRecord,
  parseLegacyVersion,
};
