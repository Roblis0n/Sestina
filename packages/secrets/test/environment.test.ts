/**

 * Environment variable backend tests.
 *
 * Tests the REAL production environment backend (src/environment.ts)
 * via dependency injection — a FakeEnvReader is injected into the real
 * createEnvironmentBackend factory. No inline reimplementation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SecretBackend, EnvReader } from "../src/port.js";

// ── Fake env reader for testing (DI: injected into real production backend) ──

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

// ── Import REAL production code ──

import { createEnvironmentBackend } from "../src/environment.js";

// ── Tests ──

describe("environment backend", () => {
  let env: FakeEnvReader;
  let backend: SecretBackend;

  beforeEach(() => {
    env = new FakeEnvReader({
      "SESTINA_SECRET_OPENAI-MAIN": "sk-env-test-key-123",
      "SESTINA_SECRET_ANTHROPIC-DEFAULT": "sk-ant-env-test-key-456",
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
    // sestina/openai-main → SESTINA_SECRET_OPENAI-MAIN (hyphens preserved)
    expect(await backend.get("sestina/openai-main")).toBeDefined();
    // sestina/anthropic-default → SESTINA_SECRET_ANTHROPIC-DEFAULT
    expect(await backend.get("sestina/anthropic-default")).toBeDefined();
  });

  it("handles multi-segment refs", async () => {
    env.set("SESTINA_SECRET_LOCAL-LLM", "local-key-789");
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
