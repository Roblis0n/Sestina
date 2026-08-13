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
export {
  createWindowsDPAPIBackend,
  createWindowsDPAPIProvider,
  applyCurrentUserACL,
} from "./windows-dpapi.js";
export type { VaultIO, ACLProvider } from "./windows-dpapi.js";
export {
  createMacOSKeychainBackend,
  createNativeKeychainProvider,
} from "./macos-keychain.js";
export {
  createLinuxSecretBackend,
  createNativeSecretServiceProvider,
} from "./linux-secret-service.js";
export {
  createEnvironmentBackend,
  createRealEnvReader,
  environmentKeyForRef,
} from "./environment.js";

// Internal helpers exposed for testing
export { __test as __controlTokenTest } from "./control-token.js";

// Secret scanner — full-mode defense-in-depth against secret leakage
export {
  scanForSecrets,
  safeStringForOutput,
  assertNoSecrets,
  safeWriteStderr,
  sanitizeArgs,
} from "./secret-scanner.js";
export type { ScanResult, SecretScanOptions } from "./secret-scanner.js";

// Unified error helpers
export {
  throwUnavailable,
  throwCorruption,
  throwNativeError,
} from "./errors.js";
