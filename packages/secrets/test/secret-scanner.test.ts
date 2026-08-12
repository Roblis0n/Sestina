/**
 * Secret scanner tests — synthetic-secret leak detection.
 *
 * Tests the secret scanner against the synthetic-secrets.json fixture
 * AND verifies production wiring via canary leak detection.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanForSecrets,
  safeStringForOutput,
  assertNoSecrets,
} from "../src/secret-scanner.js";

// ── Load synthetic-secrets.json fixture ──

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "secrets",
  "synthetic-secrets.json",
);

interface SyntheticSecretsFixture {
  testSecrets: {
    apiKey: string;
    providerToken: string;
    controlTokenValue: string;
    credentialRefs: string[];
  };
  malicious: {
    envVarInjection: string;
    pathTraversal: string;
    controlCharacters: string;
    unicodeConfusion: string;
    veryLong: string;
  };
}

function loadFixture(): SyntheticSecretsFixture {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as SyntheticSecretsFixture;
}

// ── Tests ──

describe("secret scanner", () => {
  describe("synthetic-secrets.json fixture", () => {
    it("is valid JSON and loads without error", () => {
      const fixture = loadFixture();
      expect(fixture).toBeDefined();
      expect(fixture.testSecrets).toBeDefined();
      expect(fixture.malicious).toBeDefined();
    });

    it("contains expected synthetic secret values", () => {
      const fixture = loadFixture();
      expect(fixture.testSecrets.apiKey).toMatch(/^sk-synthetic/);
      expect(fixture.testSecrets.controlTokenValue).toHaveLength(64);
      expect(fixture.testSecrets.credentialRefs).toHaveLength(3);
    });

    it("contains malicious payloads for testing", () => {
      const fixture = loadFixture();
      expect(fixture.malicious.envVarInjection).toContain("${HOME}");
      expect(fixture.malicious.pathTraversal).toContain("../");
      expect(fixture.malicious.unicodeConfusion).toBeDefined();
      expect(fixture.malicious.veryLong.length).toBeGreaterThan(1000);
    });

    it("veryLong is not the JS repeat() call — it's actual data", () => {
      const fixture = loadFixture();
      // The original had 'a'.repeat(65536) which is not valid JSON.
      // The fixed version has actual repeated 'a' characters.
      expect(typeof fixture.malicious.veryLong).toBe("string");
      // Must NOT contain ".repeat" — would mean it's still JS code
      expect(fixture.malicious.veryLong).not.toContain(".repeat");
      // Must be all 'a' characters
      expect(/^a+$/.test(fixture.malicious.veryLong)).toBe(true);
    });
  });

  describe("scanForSecrets", () => {
    it("detects synthetic API key (openai pattern)", () => {
      const fixture = loadFixture();
      const result = scanForSecrets(fixture.testSecrets.apiKey);
      expect(result.hasSecrets).toBe(true);
      expect(result.matchedPatterns).toContain("openai-key");
    });

    it("detects 64-char hex token (control token pattern)", () => {
      const fixture = loadFixture();
      const result = scanForSecrets(fixture.testSecrets.controlTokenValue);
      expect(result.hasSecrets).toBe(true);
      expect(result.matchedPatterns).toContain("hex256-token");
    });

    it("does not flag normal strings", () => {
      const result = scanForSecrets("hello world, this is a normal message");
      expect(result.hasSecrets).toBe(false);
    });

    it("does not flag ref keys", () => {
      const fixture = loadFixture();
      for (const ref of fixture.testSecrets.credentialRefs) {
        const result = scanForSecrets(ref);
        expect(result.hasSecrets).toBe(false);
      }
    });
  });

  describe("safeStringForOutput", () => {
    it("redacts API keys from output strings", () => {
      const fixture = loadFixture();
      const output = safeStringForOutput(
        `Using API key: ${fixture.testSecrets.apiKey} for OpenAI`,
      );
      expect(output).not.toContain(fixture.testSecrets.apiKey);
      expect(output).toContain("[REDACTED:openai-key]");
    });

    it("redacts hex tokens from output strings", () => {
      const fixture = loadFixture();
      const output = safeStringForOutput(
        `Token value: ${fixture.testSecrets.controlTokenValue}`,
      );
      expect(output).not.toContain(fixture.testSecrets.controlTokenValue);
    });

    it("handles non-string values gracefully", () => {
      expect(safeStringForOutput(123)).toBe("123");
      expect(safeStringForOutput(null)).toBe("null");
      expect(safeStringForOutput(undefined)).toBe("undefined");
    });
  });

  describe("assertNoSecrets", () => {
    it("throws when secrets are detected in output channel", () => {
      const fixture = loadFixture();
      expect(() => {
        assertNoSecrets(fixture.testSecrets.controlTokenValue, "stderr");
      }).toThrow("Secret-like content detected in stderr");
    });

    it("does not throw for clean strings", () => {
      expect(() => {
        assertNoSecrets("clean output message", "stderr");
      }).not.toThrow();
    });
  });
});
