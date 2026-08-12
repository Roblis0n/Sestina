/**
 * Unified sanitized SestinaError wrappers for ALL platforms.
 *
 * Every secure-storage or native-module failure MUST throw a stable,
 * sanitized SestinaError. Raw native errors (which may contain path
 * names, OS error strings, stack traces, or other potentially sensitive
 * context) are NEVER surfaced to callers.
 *
 * Applies to: Windows (DPAPI), macOS (Keychain), Linux (Secret Service),
 * and the environment backend.
 */
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import { safeWriteStderr } from "./secret-scanner.js";

/**
 * Throw sanitized secure_storage_unavailable.
 * Logs sanitized native details to stderr; thrown error is pre-approved.
 */
export function throwUnavailable(context: string, nativeError?: unknown): never {
  if (nativeError !== undefined) {
    const detail: string = (() => {
      if (nativeError instanceof Error) return nativeError.message;
      if (typeof nativeError === "string") return nativeError;
      try { return JSON.stringify(nativeError); } catch { return "Unknown error"; }
    })();
    safeWriteStderr(`[sestina] secure_storage_unavailable (${context}): ${detail}`);
  }
  throw new SestinaError(
    SestinaErrorCode.secure_storage_unavailable,
    "Secure storage is not available on this system. " +
    "Ensure the platform keyring service is running, or set " +
    "SESTINA_USE_ENV_BACKEND=true to use environment variable storage.",
  );
}

/**
 * Throw sanitized internal_error for vault corruption or write failure.
 */
export function throwCorruption(detail: string): never {
  safeWriteStderr(`[sestina] vault corruption: ${detail}`);
  throw new SestinaError(
    SestinaErrorCode.database_corrupt,
    "The secrets vault appears to be corrupted. " +
    "A backup has been saved for recovery. " +
    "Re-create secrets by re-running setup or resetting control tokens.",
  );
}

/**
 * Throw sanitized internal_error for any platform-native failure.
 * Used by macOS Keychain and Linux Secret Service when native
 * modules are unavailable or fail at runtime.
 */
export function throwNativeError(platform: string, context: string, nativeError?: unknown): never {
  if (nativeError !== undefined) {
    const detail: string = (() => {
      if (nativeError instanceof Error) return nativeError.message;
      if (typeof nativeError === "string") return nativeError;
      try { return JSON.stringify(nativeError); } catch { return "Unknown error"; }
    })();
    safeWriteStderr(`[sestina] ${platform} native error (${context}): ${detail}`);
  }
  throw new SestinaError(
    SestinaErrorCode.secure_storage_unavailable,
    `${platform} secure storage is not available. ` +
    "Ensure the native keyring/keystore service is installed and running. " +
    "Set SESTINA_USE_ENV_BACKEND=true to use environment variable storage instead.",
  );
}
