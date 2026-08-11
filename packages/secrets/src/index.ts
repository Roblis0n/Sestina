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
export { createMacOSKeychainBackend, createNativeKeychainProvider, createSecurityCLIProvider } from "./macos-keychain.js";
export { createLinuxSecretBackend, createNativeSecretServiceProvider } from "./linux-secret-service.js";
export { createEnvironmentBackend, createRealEnvReader } from "./environment.js";

// Internal helpers exposed for testing
export { __test as __controlTokenTest } from "./control-token.js";
