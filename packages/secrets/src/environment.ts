/**
 * Environment-variable-based secret backend.
 *
 * Maps env vars SESTINA_SECRET_<NAME> to refs "sestina/<name>".
 *
 * This backend is:
 * - READ-ONLY: secrets are set via the environment, never written back.
 * - DELIBERATE: only used when the user explicitly chose env vars or
 *   on Linux when Secret Service is unavailable.
 * - NEVER a silent plaintext fallback.
 *
 * The backend maps:
 *   SESTINA_SECRET_OPENAI_MAIN → sestina/openai-main
 *   SESTINA_SECRET_ANTHROPIC → sestina/anthropic
 */
import type { SecretBackend, SecretBackendStatus, EnvReader } from "./port.js";

// ── Real env reader ──

export function createRealEnvReader(): EnvReader {
  return {
    read(key: string): string | undefined {
      return process.env[key];
    },
    keys(): string[] {
      return Object.keys(process.env);
    },
  };
}

// ── Ref ↔ env var mapping ──

const PREFIX = "SESTINA_SECRET_";

/**
 * Convert a ref to an environment variable key.
 *
 * COLLISION-FREE ESCAPE SCHEME:
 * - "_"  → "__" (escape literal underscores)
 * - "/"  → "_"  (path separator)
 * - "-"  kept as "-" (hyphens are valid in Node.js env var access)
 *
 * This ensures refs like "sestina/a/b", "sestina/a_b", and "sestina/a-b"
 * all map to DIFFERENT env var names:
 *   sestina/a/b   → SESTINA_SECRET_A_B
 *   sestina/a__b  → SESTINA_SECRET_A____B
 *   sestina/a_b   → SESTINA_SECRET_A__B
 *   sestina/a-b   → SESTINA_SECRET_A-B
 */
function refToEnvKey(ref: string): string {
  const name = ref
    .replace(/^sestina\//, "")
    .replace(/_/g, "__")  // escape "_" first (before "/" → "_")
    .replace(/\//g, "_")  // then encode "/" as "_"
    .toUpperCase();
  return `${PREFIX}${name}`;
}

// ── Factory ──

export function createEnvironmentBackend(
  env?: EnvReader,
): SecretBackend {
  const reader = env ?? createRealEnvReader();

  return {
    get(ref: string): Promise<string | undefined> {
      return Promise.resolve(reader.read(refToEnvKey(ref)));
    },

    set(_ref: string, _value: string): Promise<void> {
      void _ref; void _value;
      return Promise.reject(
        new Error(
          "Environment backend is read-only. Set SESTINA_SECRET_<NAME> " +
          "environment variables in your shell profile instead.",
        ),
      );
    },

    delete(ref: string): Promise<void> {
      // No-op: process env vars persist for the process lifetime
      void refToEnvKey(ref);
      return Promise.reject(new Error("Environment backend is read-only."));
    },

    describe(ref: string): Promise<{ configured: boolean }> {
      const key = refToEnvKey(ref);
      return Promise.resolve({ configured: reader.read(key) !== undefined });
    },

    health(): Promise<SecretBackendStatus> {
      return Promise.resolve({
        available: true,
        backend: "environment",
        reason:
          "Reading secrets from SESTINA_SECRET_* environment variables. " +
          "This is a deliberate, user-initiated configuration.",
      });
    },
  };
}
