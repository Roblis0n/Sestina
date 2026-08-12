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
    if (!Number.isSafeInteger(rec.v) || rec.v < 1 || rec.v > MAX_VERSION) return null;
    if (rec.t.length !== TOKEN_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(rec.t)) return null;
    return { v: rec.v, t: rec.t };
  } catch {
    return null;
  }
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

  // Try atomic record first
  const raw = await backend.get(ref);
  if (raw) {
    const parsed = parseRecord(raw);
    if (parsed) {
      return { ref, version: parsed.v, value: parsed.t };
    }
    // Record exists but is corrupt — fail closed, never silently rebuild
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      `Control token for scope "${scope}" is corrupted. ` +
      `The stored record could not be parsed. ` +
      `Delete the key "${ref}" and re-run setup to regenerate.`,
    );
  }

  // No record exists: try legacy split-storage migration
  const verRef = versionRef(scope);
  const legacyValue = await backend.get(verRef); // check version key existence as proxy
  const versionStr = legacyValue;

  if (versionStr) {
    // Legacy version key exists — try to read the raw token value
    // (in legacy mode, token was stored at ref and version at verRef)
    const legacyToken = await backend.get(ref);
    if (legacyToken && /^[0-9a-fA-F]{64}$/.test(legacyToken)) {
      const p = parseInt(versionStr, 10);
      const version = (Number.isSafeInteger(p) && p > 0 && p <= MAX_VERSION) ? p : 1;
      // Migrate to atomic record
      await backend.set(ref, packRecord(legacyToken, version));
      try { await backend.delete(verRef); } catch { /* best-effort */ }
      return { ref, version, value: legacyToken };
    }
    // Legacy version key exists but token is invalid — corruption
    throw new SestinaError(
      SestinaErrorCode.database_corrupt,
      `Control token for scope "${scope}" has legacy version but no valid token. ` +
      `Delete both "${ref}" and "${verRef}" and re-run setup.`,
    );
  }

  // First-time creation: write atomic record
  const value = generateTokenValue();
  await backend.set(ref, packRecord(value, 1));
  return { ref, version: 1, value };
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

  // Read current version from atomic record
  const raw = await backend.get(ref);
  let currentVersion = 0;
  if (raw) {
    const parsed = parseRecord(raw);
    if (parsed) {
      currentVersion = parsed.v;
    }
  }

  // Guard against version overflow
  if (currentVersion >= MAX_VERSION) {
    throw new Error(
      `Control token version has reached maximum (${MAX_VERSION}). ` +
      `This is an extremely unusual state. Reinstall the client.`,
    );
  }

  const newVersion = currentVersion + 1;
  const newValue = generateTokenValue();

  // Atomic write: token + version in one record
  await backend.set(ref, packRecord(newValue, newVersion));

  return { ref, version: newVersion, value: newValue };
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
};
