import type { SecretBackend, SecretPlatform } from "@sestina/secrets";

const SECURE_STORAGE_PACKAGE = "@sestina/secrets";

/**
 * Resolve platform secure storage only for the desktop composition root.
 * Keeping the runtime package specifier indirect prevents unrelated Core
 * consumers from bundling native keyring/DPAPI binaries they never use.
 */
export async function createSecretBackend(
  platform: SecretPlatform,
  options: { environmentFallback?: false } = {},
): Promise<SecretBackend> {
  const secureStorage = (await import(SECURE_STORAGE_PACKAGE)) as {
    createSecretBackend(
      value: SecretPlatform,
      deps?: { envReader: { read: () => undefined; keys: () => string[] } },
    ): SecretBackend;
  };
  return secureStorage.createSecretBackend(
    platform,
    options.environmentFallback === false
      ? { envReader: { read: () => undefined, keys: () => [] } }
      : undefined,
  );
}
