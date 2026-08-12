export {
  createSecretBackend,
  getOrCreateControlToken,
  resetControlToken,
  verifyChallengeResponse,
} from "./port.js";
export type {
  SecretBackend,
  SecretBackendDeps,
  SecretBackendStatus,
  SecretPlatform,
  DPAPIProvider,
  KeychainProvider,
  SecretServiceProvider,
  EnvReader,
  ControlToken,
  ControlTokenScope,
} from "./port.js";

// Platform-specific factories (for testing and direct use)
export { createWindowsDPAPIBackend, createWindowsDPAPIProvider } from "./windows-dpapi.js";
export { createMacOSKeychainBackend, createNativeKeychainProvider } from "./macos-keychain.js";
export { createLinuxSecretBackend, createNativeSecretServiceProvider } from "./linux-secret-service.js";
export { createEnvironmentBackend, createRealEnvReader } from "./environment.js";

// Internal helpers exposed for testing
export { __test as __controlTokenTest } from "./control-token.js";

// Secret scanner — defense-in-depth against secret leakage
export {
  scanForSecrets,
  safeStringForOutput,
  assertNoSecrets,
} from "./secret-scanner.js";
export type { ScanResult } from "./secret-scanner.js";

// Unified error helpers
export { throwUnavailable, throwCorruption } from "./errors.js";
