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
import { getOrCreateControlToken } from "../src/control-token.js";

// ── Tests ──

describe("environment backend", () => {
  let env: FakeEnvReader;
  let backend: SecretBackend;

  beforeEach(() => {
    env = new FakeEnvReader({
      SESTINA_SECRET_6F70656E61692D6D61696E: "sk-env-test-key-123",
      SESTINA_SECRET_616E7468726F7069632D64656661756C74:
        "sk-ant-env-test-key-456",
    });
    backend = createEnvironmentBackend(env);
  });

  afterEach(() => {
    // Clean up
  });

  it("reads secrets from environment variables", async () => {
    expect(await backend.get("sestina/openai-main")).toBe(
      "sk-env-test-key-123",
    );
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
    // UTF-8 hex encoding is POSIX-shell-safe and collision-free.
    expect(await backend.get("sestina/openai-main")).toBeDefined();
    expect(await backend.get("sestina/anthropic-default")).toBeDefined();
  });

  it("handles multi-segment refs", async () => {
    env.set("SESTINA_SECRET_6C6F63616C2D6C6C6D", "local-key-789");
    expect(await backend.get("sestina/local-llm")).toBe("local-key-789");
  });

  it("uses only portable shell identifier characters without ref collisions", async () => {
    env.set("SESTINA_SECRET_612F62", "slash");
    env.set("SESTINA_SECRET_615F62", "underscore");
    env.set("SESTINA_SECRET_612D62", "hyphen");

    expect(await backend.get("sestina/a/b")).toBe("slash");
    expect(await backend.get("sestina/a_b")).toBe("underscore");
    expect(await backend.get("sestina/a-b")).toBe("hyphen");
  });

  it("accepts a pre-provisioned raw control token without trying to rewrite env", async () => {
    const rawToken = "a5".repeat(32);
    env.set("SESTINA_SECRET_636F6E74726F6C2D746F6B656E2F697063", rawToken);

    await expect(getOrCreateControlToken(backend, "ipc")).resolves.toEqual({
      ref: "sestina/control-token/ipc",
      version: 1,
      value: rawToken,
    });
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
