/**
 * Control token generation, storage, versioning, and rotation.
 *
 * Tokens are 256-bit random values stored in the OS secret backend.
 * They survive upgrades, only rotate on explicit reset, and are
 * isolated to the current OS user by the backend.
 *
 * The token proves "current OS user installed this client" ONLY.
 * It does NOT grant direct-user provenance to Hooks, MCP, or peers.
 *
 * After reset, the old token is IMMEDIATELY invalidated — there is
 * no grace period, no previous-token fallback, and no setTimeout logic.
 * In-flight handshakes using the old token are rejected.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SecretBackend } from "./port.js";
import type { ControlToken, ControlTokenScope } from "./port.js";

// ── Constants ──

const TOKEN_BYTES = 32; // 256 bits
const TOKEN_HEX_LENGTH = 64; // 32 bytes → 64 hex chars

// ── Ref key computation ──

function tokenRef(scope: ControlTokenScope): string {
  return `sestina/control-token/${scope}`;
}

function versionRef(scope: ControlTokenScope): string {
  return `sestina/control-token/${scope}/version`;
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
 *   immediately invalidated.
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
    const parsed = versionStr ? parseInt(versionStr, 10) : 1;
    // Guard against corrupted version (NaN, negative, non-finite)
    const version = (Number.isFinite(parsed) && parsed > 0) ? parsed : 1;
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
 * Generates a new 256-bit value, increments the version, and immediately
 * overwrites the stored token. The old value is permanently invalidated
 * — there is no grace period or previous-token fallback.
 */
export async function resetControlToken(
  backend: SecretBackend,
  scope: ControlTokenScope,
): Promise<ControlToken> {
  const ref = tokenRef(scope);
  const verRef = versionRef(scope);

  // Read current state
  const currentVersionStr = await backend.get(verRef);
  const parsed = currentVersionStr ? parseInt(currentVersionStr, 10) : 0;
  // Guard against corrupted version (NaN, negative, non-finite)
  const currentVersion = (Number.isFinite(parsed) && parsed >= 0) ? parsed : 0;
  const newVersion = currentVersion + 1;

  // Generate and store new token (overwrites old immediately)
  const newValue = generateTokenValue();
  await backend.set(ref, newValue);
  await backend.set(verRef, String(newVersion));

  return { ref, version: newVersion, value: newValue };
}

// ── Challenge verification ──

/**
 * Verify a challenge response against the stored control token.
 *
 * Uses constant-time comparison via timingSafeEqual.
 * Only the current token value is accepted — there is no grace-period
 * fallback to a previous token.
 *
 * @returns true if the response matches the current token.
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

  const currentValue = await backend.get(ref);
  if (!currentValue) return false;

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
  tokenRef,
  versionRef,
};
