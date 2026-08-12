/**
 * Unified SestinaError wrappers for the secrets package.
 *
 * Every secure-storage failure MUST throw a stable, sanitized SestinaError.
 * Raw native errors (which may contain path names, stack traces, or other
 * potentially sensitive context) are NEVER allowed to propagate to callers.
 *
 * All error messages are pre-approved: they contain no secret material,
 * no file paths, and no raw OS error strings.
 */
import { SestinaError, SestinaErrorCode } from "@sestina/schema";

/**
 * Throw a sanitized secure_storage_unavailable error.
 * Native error details are logged to stderr after scanning,
 * but the thrown error contains only the pre-approved message.
 */
export function throwUnavailable(context: string, nativeError?: unknown): never {
  // Log native details to stderr (after secret scan)
  if (nativeError !== undefined) {
    const detail: string = (() => {
      if (nativeError instanceof Error) return nativeError.message;
      if (typeof nativeError === "string") return nativeError;
      try { return JSON.stringify(nativeError); } catch { return "Unknown error"; }
    })();
    logSanitized(
      `[sestina] secure_storage_unavailable (${context}): ${detail}`,
    );
  }
  throw new SestinaError(
    SestinaErrorCode.secure_storage_unavailable,
    "Secure storage is not available on this system. " +
    "Ensure the platform keyring service is running, or set " +
    "SESTINA_USE_ENV_BACKEND=true to use environment variable storage.",
  );
}

/**
 * Throw a sanitized internal_error for vault corruption.
 * The corruption detail is logged but never surfaced in the thrown error.
 */
export function throwCorruption(detail: string): never {
  logSanitized(`[sestina] vault corruption: ${detail}`);
  throw new SestinaError(
    SestinaErrorCode.database_corrupt,
    "The secrets vault appears to be corrupted. " +
    "A backup has been saved for recovery. " +
    "Re-create secrets by re-running setup or resetting control tokens.",
  );
}

// ── Internal: sanitized stderr logging ──

import { scanForSecrets } from "./secret-scanner.js";

function logSanitized(message: string): void {
  // Scan before writing to stderr
  const result = scanForSecrets(message);
  if (result.hasSecrets) {
    // Redact: replace the message with a safe version
    const redacted = message.replace(
      /[0-9a-fA-F]{32,}/g,
      "[REDACTED:hex-token]",
    );
    process.stderr.write(`${redacted}\n`);
    return;
  }
  process.stderr.write(`${message}\n`);
}
