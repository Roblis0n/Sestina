/**
 * Environment-variable-based secret backend.
 *
 * Maps env vars SESTINA_SECRET_<NAME> to refs "sestina/<name>".
 *
 * This backend is:
 * - READ-ONLY: secrets are set via the environment, never written back.
 * - DELIBERATE: selected only when the user explicitly opts in.
 * - NEVER a silent plaintext fallback.
 *
 * Ref suffixes are UTF-8 hex encoded so every key is a portable POSIX shell
 * identifier and distinct refs can never collide.
 */
import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { SecretBackend, SecretBackendStatus, EnvReader } from "./port.js";
import { registerControlTokenCoordination } from "./control-token.js";

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
 * The portion after `sestina/` is encoded as uppercase UTF-8 hex. The output
 * therefore uses only `[A-Z0-9_]`, works with `export KEY=value`, preserves
 * Unicode and case exactly, and is collision-free.
 */
export function environmentKeyForRef(ref: string): string {
  if (!ref.startsWith("sestina/") || ref.length === "sestina/".length) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "Secret references must start with sestina/ and include a name.",
    );
  }
  const name = ref.slice("sestina/".length);
  return `${PREFIX}${Buffer.from(name, "utf8").toString("hex").toUpperCase()}`;
}

// ── Factory ──

export function createEnvironmentBackend(env?: EnvReader): SecretBackend {
  const reader = env ?? createRealEnvReader();

  const backend: SecretBackend = {
    get(ref: string): Promise<string | undefined> {
      return Promise.resolve(reader.read(environmentKeyForRef(ref)));
    },

    set(ref: string, value: string): Promise<void> {
      void value;
      return Promise.reject(
        new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          `Environment backend is read-only. Set ${environmentKeyForRef(ref)} ` +
            "in the service environment or shell profile instead.",
        ),
      );
    },

    delete(ref: string): Promise<void> {
      void environmentKeyForRef(ref);
      return Promise.reject(
        new SestinaError(
          SestinaErrorCode.secure_storage_unavailable,
          "Environment backend is read-only.",
        ),
      );
    },

    describe(ref: string): Promise<{ configured: boolean }> {
      const key = environmentKeyForRef(ref);
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
  registerControlTokenCoordination(backend, "linux:environment");
  return backend;
}
