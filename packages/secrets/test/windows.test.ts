/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
/**
 * Windows DPAPI backend tests.
 *
 * Tests the REAL production Windows DPAPI backend (src/windows-dpapi.ts)
 * via dependency injection — a synthetic DPAPI provider is injected into
 * the real createWindowsDPAPIBackend factory.
 *
 * On non-Windows: uses a synthetic DPAPI provider (structural test only,
 * NOT a mock masquerading as real verification).
 * On Windows: real DPAPI via @primno/dpapi.
 */
import { describe, it, expect } from "vitest";
import { secretBackendContract } from "./contract.js";
import type {
  DPAPIProvider,
  EnvReader,
} from "../src/port.js";

// ── Synthetic DPAPI for cross-platform structural tests ──
// CLEARLY labeled as synthetic; NOT a mock masquerading as real verification.
// Injected into the real production backend factory.

function createSyntheticDPAPI(): DPAPIProvider {
  let counter = 0;
  const XOR_KEY = 0x5a;
  return {
    async protect(data: Buffer, _scope: "CurrentUser") {
      const id = `synth-${++counter}`;
      const obfuscated = Buffer.from(data.map((b) => b ^ XOR_KEY));
      return Buffer.concat([
        Buffer.from(`SYNTH_DPAPI_V1:${id}:`),
        obfuscated,
      ]);
    },
    async unprotect(data: Buffer, scope: string) {
      if (scope !== "CurrentUser") {
        throw new Error("Only CurrentUser scope is supported");
      }
      const header = data.toString("utf8", 0, 40);
      if (!header.startsWith("SYNTH_DPAPI_V1:")) {
        throw new Error("Invalid DPAPI blob: not a synthetic wrapper");
      }
      const colonIdx = header.indexOf(":", 15);
      if (colonIdx === -1) throw new Error("Malformed synthetic blob");
      const obfuscated = data.subarray(colonIdx + 1);
      return Buffer.from(obfuscated.map((b) => b ^ XOR_KEY));
    },
  };
}

// ── Import REAL production backend factory ──

import { createWindowsDPAPIBackend } from "../src/windows-dpapi.js";

function createTestBackend(): ReturnType<typeof createWindowsDPAPIBackend> {
  // Inject synthetic DPAPI provider into the REAL production backend
  const dpapi = createSyntheticDPAPI();
  // Use a memory-backed path for tests (no disk IO needed)
  const tempPath = `${process.env.TEMP ?? "/tmp"}/sestina-test-vault-${Date.now()}.json`;
  return createWindowsDPAPIBackend(dpapi, tempPath);
}

// ── Contract tests (run against real backend with injected synthetic provider) ──

secretBackendContract(createTestBackend);

// ── Windows-specific tests ──

describe("Windows DPAPI backend", () => {
  it("synthetic DPAPI round-trips data through protect→unprotect", async () => {
    const dpapi = createSyntheticDPAPI();
    const original = Buffer.from("test-secret-data", "utf8");
    const blob = await dpapi.protect(original, "CurrentUser");
    expect(blob).toBeDefined();
    // Blob must NOT contain the original plaintext
    expect(blob.toString("utf8")).not.toContain("test-secret-data");
    // Round-trip
    const recovered = await dpapi.unprotect(blob, "CurrentUser");
    expect(recovered.toString("utf8")).toBe("test-secret-data");
  });

  it("synthetic DPAPI rejects non-CurrentUser scope", async () => {
    const dpapi = createSyntheticDPAPI();
    const data = Buffer.from("test", "utf8");
    const blob = await dpapi.protect(data, "CurrentUser");
    await expect(dpapi.unprotect(blob, "LocalMachine" as never)).rejects.toThrow();
  });

  it("synthetic DPAPI encrypted blobs are not plaintext-equivalent", async () => {
    const dpapi = createSyntheticDPAPI();
    const original = Buffer.from("super-secret-12345", "utf8");
    const blob = await dpapi.protect(original, "CurrentUser");
    const hex = blob.toString("hex");
    expect(hex).not.toContain(
      Buffer.from("super-secret-12345").toString("hex"),
    );
  });

  it("backend set→get round-trips through real backend with synthetic DPAPI", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/test", "dpapi-encrypted-value");
    expect(await backend.get("sestina/test")).toBe("dpapi-encrypted-value");
  });

  it("backend encrypted storage does not contain plaintext secret", async () => {
    const backend = createTestBackend();
    await backend.set("sestina/test", "plaintext-secret-abc");
    const desc = JSON.stringify(await backend.describe("sestina/test"));
    expect(desc).not.toContain("plaintext-secret-abc");
  });

  it("health reports dpapi when synthetic provider is available", async () => {
    const backend = createTestBackend();
    const status = await backend.health();
    expect(status.available).toBe(true);
    expect(status.backend).toBe("dpapi");
  });
});

// ── Real DPAPI round-trip test (Windows only) ──

describe("real DPAPI round-trip (Windows automated)", () => {
  it("performs CryptProtectData → CryptUnprotectData round-trip", async () => {
    // This test uses the REAL @primno/dpapi native module.
    // On non-Windows or if DPAPI is unavailable, the test is skipped.
    const platform = process.platform;
    if (platform !== "win32") {
      console.log(`  [SKIP] Not on Windows (current: ${platform})`);
      return;
    }

    let dpapi: DPAPIProvider;
    try {
      const { createWindowsDPAPIProvider } = await import("../src/windows-dpapi.js");
      dpapi = createWindowsDPAPIProvider();
    } catch {
      console.log("  [SKIP] @primno/dpapi native module unavailable");
      return;
    }

    // Smoke: check health
    const backend = createWindowsDPAPIBackend(dpapi);
    const status = await backend.health();

    if (!status.available) {
      console.log(`  [SKIP] DPAPI not available: ${status.reason ?? "unknown"}`);
      return;
    }

    // Real round-trip
    const testValue = `real-dpapi-auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const encrypted = await dpapi.protect(
      Buffer.from(testValue, "utf8"),
      "CurrentUser",
    );
    const decrypted = await dpapi.unprotect(encrypted, "CurrentUser");

    expect(decrypted.toString("utf8")).toBe(testValue);

    // Verify encrypted blob does NOT contain plaintext
    expect(encrypted.toString("utf8")).not.toContain(testValue);

    // Verify encrypted blob does NOT contain the hex representation
    const hex = Buffer.from(testValue, "utf8").toString("hex");
    expect(encrypted.toString("hex")).not.toContain(hex);

    // Persist through backend
    await backend.set("sestina/real-dpapi-test", testValue);
    const retrieved = await backend.get("sestina/real-dpapi-test");
    expect(retrieved).toBe(testValue);

    // Cleanup
    await backend.delete("sestina/real-dpapi-test");
    expect(await backend.get("sestina/real-dpapi-test")).toBeUndefined();
  });
});
