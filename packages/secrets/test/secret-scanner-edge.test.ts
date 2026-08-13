/**
 * Secret scanner edge-case tests — RED tests for known failures.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  scanForSecrets,
  safeStringForOutput,
  safeWriteStderr,
  sanitizeArgs,
} from "../src/secret-scanner.js";

describe("secret scanner edge cases (RED→GREEN)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── FAILURE 5: Two same-type secrets have matchCount of 1 ──
  describe("multiple same-type secrets", () => {
    it("RED: detects both hex256 tokens in a string with two 64-char hex values", () => {
      const t1 = "a1".repeat(32);
      const t2 = "b2".repeat(32);
      const result = scanForSecrets(`token1: ${t1} and token2: ${t2}`);
      expect(result.hasSecrets).toBe(true);
      expect(result.matchCount).toBe(2);
    });

    it("RED: detects both openai keys in a string with two sk- keys", () => {
      const result = scanForSecrets(
        "key1: sk-test-aaaaaaaaaaaaaaaaaaaa key2: sk-test-bbbbbbbbbbbbbbbbbbbb",
      );
      expect(result.matchCount).toBe(2);
    });

    it("RED: safeStringForOutput redacts ALL secrets, not just first", () => {
      const t1 = "a1".repeat(32);
      const t2 = "b2".repeat(32);
      const output = safeStringForOutput(`a: ${t1} b: ${t2}`);
      expect(output).not.toContain(t1);
      expect(output).not.toContain(t2);
      // Should contain two REDACTED markers
      const redactedCount = (output.match(/\[REDACTED:hex256-token\]/g) ?? [])
        .length;
      expect(redactedCount).toBe(2);
    });
  });

  // ── FAILURE 6: Arbitrary known canary patterns ──
  describe("all 11 canary patterns", () => {
    it("detects hex128-token (32 hex chars)", () => {
      const r = scanForSecrets("key: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("hex128-token");
    });

    it("detects anthropic-key", () => {
      const r = scanForSecrets("key: sk-ant-api03-xxxxxxxxxxxxxxxxxxxx");
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("anthropic-key");
    });

    it("detects github-token", () => {
      const r = scanForSecrets(
        "token: ghp_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
      );
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("github-token");
    });

    it("detects aws-key", () => {
      const r = scanForSecrets("key: AKIAIOSFODNN7EXAMPLE"); // valid-format AWS key
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("aws-key");
    });

    it("detects jwt", () => {
      const r = scanForSecrets(
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      );
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("jwt");
    });

    it("detects base64-secret (40+ chars)", () => {
      const r = scanForSecrets(
        "secret: dGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgc3RyaW5nIHRoYXQgaXMgdXNlZCBhcyBhIHNlY3JldA==",
      );
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("base64-secret");
    });

    it("detects dpapi-blob (200+ hex chars)", () => {
      const blob = "a1".repeat(101); // 202 hex chars
      const r = scanForSecrets(`data: ${blob}`);
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("dpapi-blob");
    });

    it("detects pem-private-key", () => {
      const r = scanForSecrets("key: -----BEGIN RSA PRIVATE KEY-----");
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("pem-private-key");
    });

    it("detects generic-api-key", () => {
      const r = scanForSecrets('config: api_key = "sk-12345678901234567890"');
      expect(r.hasSecrets).toBe(true);
      expect(r.matchedPatterns).toContain("generic-api-key");
    });
  });

  // ── Output boundary tests ──
  describe("output boundary functions", () => {
    it("safeWriteStderr writes only the redacted form", () => {
      const t =
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
      const writes: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
      const r = safeWriteStderr(`token: ${t}`);
      expect(r).toBe(false);
      expect(writes.join("")).not.toContain(t);
      expect(writes.join("")).toContain("[REDACTED:hex256-token]");
    });

    it("safeWriteStderr returns true for clean messages", () => {
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const r = safeWriteStderr("all clear, nothing to see here");
      expect(r).toBe(true);
    });

    it("sanitizeArgs replaces secret-containing args", () => {
      const t =
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
      const args = sanitizeArgs(["cmd", "--token", t, "--verbose"]);
      expect(args[0]).toBe("cmd");
      expect(args[1]).toBe("--token");
      expect(args[2]).toBe("[REDACTED]"); // secret replaced
      expect(args[3]).toBe("--verbose");
    });

    it("sanitizeArgs does not modify clean args", () => {
      const args = sanitizeArgs(["cmd", "--output", "result.txt"]);
      expect(args).toEqual(["cmd", "--output", "result.txt"]);
    });

    it("detects and redacts an arbitrary caller-supplied canary", () => {
      const canary = "sestina-canary-4f8d-qa";
      const text = `native failure included ${canary}`;

      const scan = scanForSecrets(text, { knownSecrets: [canary] });
      const output = safeStringForOutput(text, { knownSecrets: [canary] });

      expect(scan.hasSecrets).toBe(true);
      expect(scan.matchCount).toBe(1);
      expect(scan.matchedPatterns).toContain("known-secret");
      expect(output).not.toContain(canary);
      expect(output).toContain("[REDACTED:known-secret]");
    });

    it("scans the string form of Error and object values", () => {
      const canary = "sestina-object-canary-qa";
      const errorOutput = safeStringForOutput(new Error(`native ${canary}`), {
        knownSecrets: [canary],
      });
      const objectOutput = safeStringForOutput(
        { toString: () => `object ${canary}` },
        { knownSecrets: [canary] },
      );

      expect(errorOutput).not.toContain(canary);
      expect(objectOutput).not.toContain(canary);
      expect(errorOutput).toContain("[REDACTED:known-secret]");
      expect(objectOutput).toContain("[REDACTED:known-secret]");
    });

    it("sanitizes arbitrary known secrets in subprocess arguments", () => {
      const canary = "sestina-canary-argv-qa";
      expect(
        sanitizeArgs(["tool", canary], { knownSecrets: [canary] }),
      ).toEqual(["tool", "[REDACTED]"]);
    });
  });
});
