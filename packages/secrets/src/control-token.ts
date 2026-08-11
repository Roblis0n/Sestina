/**
 * Control token generation, storage, versioning, and rotation.
 *
 * Tokens are 256-bit random values stored in the OS secret backend.
 * They survive upgrades, only rotate on explicit reset, and are
 * isolated to the current OS user by the backend.
 *
 * The token proves "current OS user installed this client" ONLY.
 * It does NOT grant direct-user provenance to Hooks, MCP, or peers.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SecretBackend } from "./port.js";
import type { ControlToken, ControlTokenScope } from "./port.js";

// ── Constants ──

const TOKEN_BYTES = 32; // 256 bits
const TOKEN_HEX_LENGTH = 64; // 32 bytes → 64 hex chars
const GRACE_PERIOD_MS = 30_000; // 30-second grace period after rotation

// ── Ref key computation ──

function tokenRef(scope: ControlTokenScope): string {
  return `sestina/control-token/${scope}`;
}

function versionRef(scope: ControlTokenScope): string {
  return `sestina/control-token/${scope}/version`;
}

function previousRef(scope: ControlTokenScope): string {
  return `sestina/control-token/${scope}/previous`;
}

// ── Token generation ──

function generateTokenValue(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

// ── Public API ──

/**
 * Get or create a versioned control token for the given scope.
 *
 * - First call: generates a fresh 256-bit token (version 1).
 * - Subsequent calls: returns the existing token unchanged.
 * - After reset: version increments, new random value, old value
 *   kept in grace-period slot for in-flight handshakes.
 */
export async function getOrCreateControlToken(
  backend: SecretBackend,
  scope: ControlTokenScope,
): Promise<ControlToken> {
  const ref = tokenRef(scope);
  const verRef = versionRef(scope);

  const existing = await backend.get(ref);
  if (existing) {
    const versionStr = await backend.get(verRef);
    const version = versionStr ? parseInt(versionStr, 10) : 1;
    return { ref, version, value: existing };
  }

  // First-time creation
  const value = generateTokenValue();
  await backend.set(ref, value);
  await backend.set(verRef, "1");
  return { ref, version: 1, value };
}

/**
 * Explicitly rotate (reset) a control token.
 *
 * Generates a new 256-bit value, increments the version, saves the
 * old value as "previous" for a 30-second grace period, and stores
 * the new token.
 *
 * After rotation, old challenges using the previous value are rejected
 * once the grace period expires.
 */
export async function resetControlToken(
  backend: SecretBackend,
  scope: ControlTokenScope,
): Promise<ControlToken> {
  const ref = tokenRef(scope);
  const verRef = versionRef(scope);
  const prevRef = previousRef(scope);

  // Read current state
  const currentValue = await backend.get(ref);
  const currentVersionStr = await backend.get(verRef);
  const currentVersion = currentVersionStr ? parseInt(currentVersionStr, 10) : 0;
  const newVersion = currentVersion + 1;

  // Save previous value for grace period
  if (currentValue) {
    await backend.set(prevRef, currentValue);
  }

  // Generate and store new token
  const newValue = generateTokenValue();
  await backend.set(ref, newValue);
  await backend.set(verRef, String(newVersion));

  // Schedule grace period cleanup
  setTimeout(() => {
    backend.get(prevRef).then((stillPrevious) => {
      if (stillPrevious === currentValue) {
        return backend.delete(prevRef);
      }
      return undefined;
    }).catch(() => {
      // Best-effort cleanup; old token expires naturally
    });
  }, GRACE_PERIOD_MS).unref();

  return { ref, version: newVersion, value: newValue };
}

// ── Challenge verification ──

/**
 * Verify a challenge response against the stored control token.
 *
 * Uses constant-time comparison via timingSafeEqual.
 * Accepts both the current token value and the previous value
 * (during the grace period after rotation).
 *
 * @returns true if the response matches either current or grace-period token.
 */
export async function verifyChallengeResponse(
  backend: SecretBackend,
  scope: ControlTokenScope,
  expectedHMAC: Buffer,
  nonceClient: Buffer,
  nonceServer: Buffer,
  role: string,
): Promise<boolean> {
  const ref = tokenRef(scope);
  const prevRef = previousRef(scope);

  const currentValue = await backend.get(ref);
  const previousValue = await backend.get(prevRef);

  const candidates = [currentValue, previousValue].filter(
    (v): v is string => v !== undefined,
  );

  const { createHmac } = await import("node:crypto");
  const message = Buffer.concat([nonceClient, nonceServer, Buffer.from(role)]);

  for (const candidate of candidates) {
    const key = Buffer.from(candidate, "hex");
    if (key.length !== TOKEN_BYTES) continue;
    const expected = createHmac("sha256", key).update(message).digest();
    if (expected.length === expectedHMAC.length) {
      if (timingSafeEqual(expected, expectedHMAC)) {
        return true;
      }
    }
  }

  return false;
}

// ── Export helpers for testing ──

export const __test = {
  TOKEN_BYTES,
  TOKEN_HEX_LENGTH,
  GRACE_PERIOD_MS,
  tokenRef,
  versionRef,
  previousRef,
};
