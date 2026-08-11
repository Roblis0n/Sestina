/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
/**
 * Environment variable backend tests.
 *
 * Tests the environment-based SecretBackend used:
 * - As a fallback on Linux when Secret Service is unavailable
 * - For reading SESTINA_* environment variables on all platforms
 *
 * The environment backend maps SESTINA_SECRET_<NAME> to ref "sestina/<name>".
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SecretBackend } from "../src/port.js";
import type { EnvReader } from "../src/port.js";

// ── Fake env reader for testing ──

class FakeEnvReader implements EnvReader {
  private store: Map<string, string>;
  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }
  read(key: string): string | undefined {
    return this.store.get(key);
  }
  keys(): string[] {
    return Array.from(this.store.keys());
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  delete(key: string): void {
    this.store.delete(key);
  }
}

// ── Inline environment backend (will move to src/environment.ts) ──

function createEnvironmentBackend(
  env: EnvReader,
  options?: { readOnly?: boolean },
): SecretBackend {
  const readOnly = options?.readOnly ?? true;
  const PREFIX = "SESTINA_SECRET_";

  function envKeyToRef(envKey: string): string {
    // SESTINA_SECRET_OPENAI_MAIN → sestina/openai-main
    const name = envKey.slice(PREFIX.length).toLowerCase().replace(/_/g, "-");
    return `sestina/${name}`;
  }

  function refToEnvKey(ref: string): string {
    // sestina/openai-main → SESTINA_SECRET_OPENAI_MAIN
    const name = ref.replace(/^sestina\//, "").replace(/-/g, "_").toUpperCase();
    return `${PREFIX}${name}`;
  }

  return {
    async get(ref: string) {
      return env.read(refToEnvKey(ref));
    },
    async set(_ref: string, _value: string) {
      if (readOnly) {
        throw new Error("Environment backend is read-only");
      }
      // Not implemented for testing — env vars are set externally
    },
    async delete(ref: string) {
      if (readOnly) {
        throw new Error("Environment backend is read-only");
      }
      // Check existence first
      const key = refToEnvKey(ref);
      if (!env.read(key)) return; // idempotent
    },
    async describe(ref: string) {
      return { configured: env.read(refToEnvKey(ref)) !== undefined };
    },
    async health() {
      return {
        available: true,
        backend: "environment" as const,
        reason: "Using environment variables for secrets",
      };
    },
  };
}

// ── Tests ──

describe("environment backend", () => {
  let env: FakeEnvReader;
  let backend: SecretBackend;

  beforeEach(() => {
    env = new FakeEnvReader({
      SESTINA_SECRET_OPENAI_MAIN: "sk-env-test-key-123",
      SESTINA_SECRET_ANTHROPIC_DEFAULT: "sk-ant-env-test-key-456",
    });
    backend = createEnvironmentBackend(env);
  });

  afterEach(() => {
    // Clean up
  });

  it("reads secrets from environment variables", async () => {
    expect(await backend.get("sestina/openai-main")).toBe("sk-env-test-key-123");
  });

  it("returns undefined for unset environment variables", async () => {
    expect(await backend.get("sestina/unknown-provider")).toBeUndefined();
  });

  it("describe returns configured status without value", async () => {
    expect(await backend.describe("sestina/openai-main")).toEqual({
      configured: true,
    });
    expect(await backend.describe("sestina/unknown")).toEqual({
      configured: false,
    });
    const serialized = JSON.stringify(
      await backend.describe("sestina/openai-main"),
    );
    expect(serialized).not.toContain("sk-env-test-key-123");
  });

  it("maps ref names to SESTINA_SECRET_ env vars", async () => {
    // The mapping is: sestina/openai-main → SESTINA_SECRET_OPENAI_MAIN
    expect(await backend.get("sestina/openai-main")).toBeDefined();
    // And: sestina/anthropic-default → SESTINA_SECRET_ANTHROPIC_DEFAULT
    expect(await backend.get("sestina/anthropic-default")).toBeDefined();
  });

  it("handles multi-segment refs", async () => {
    env.set("SESTINA_SECRET_LOCAL_LLM", "local-key-789");
    expect(await backend.get("sestina/local-llm")).toBe("local-key-789");
  });

  it("is read-only by default", async () => {
    await expect(backend.set("sestina/new-key", "value")).rejects.toThrow(
      "read-only",
    );
  });

  it("health reports environment backend", async () => {
    const status = await backend.health();
    expect(status.backend).toBe("environment");
    expect(status.available).toBe(true);
  });
});
