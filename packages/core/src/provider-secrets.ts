import type { SecretBackend, SecretPlatform } from "@sestina/secrets";

const SECURE_STORAGE_PACKAGE = "@sestina/secrets";

/**
 * Resolve platform secure storage only for the desktop composition root.
 * Keeping the runtime package specifier indirect prevents unrelated Core
 * consumers from bundling native keyring/DPAPI binaries they never use.
 */
export async function createSecretBackend(platform: SecretPlatform): Promise<SecretBackend> {
  const secureStorage = await import(SECURE_STORAGE_PACKAGE) as {
    createSecretBackend(value: SecretPlatform): SecretBackend;
  };
  return secureStorage.createSecretBackend(platform);
}
