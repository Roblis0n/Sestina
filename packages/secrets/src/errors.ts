/** Stable, non-secret-bearing errors for every native storage boundary. */
import { SestinaError, SestinaErrorCode } from "@sestina/schema";

export function throwUnavailable(
  context: string,
  nativeError?: unknown,
): never {
  void context;
  void nativeError;
  throw new SestinaError(
    SestinaErrorCode.secure_storage_unavailable,
    "Secure storage is not available for the current user. " +
      "Ensure the platform keyring service is running and its permissions are valid.",
  );
}

export function throwCorruption(detail: string): never {
  void detail;
  throw new SestinaError(
    SestinaErrorCode.database_corrupt,
    "The secrets vault is corrupted or could not be written safely. " +
      "Inspect the preserved vault record, then re-run setup or reset the control token.",
  );
}

export function throwNativeError(
  platform: string,
  context: string,
  nativeError?: unknown,
): never {
  void context;
  void nativeError;
  throw new SestinaError(
    SestinaErrorCode.secure_storage_unavailable,
    `${platform} secure storage is not available. ` +
      "Ensure the native keyring service is installed, running, and accessible to the current user.",
  );
}
