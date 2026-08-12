/**
 * Synthetic-secret scanner — full-mode defense-in-depth sanitizer.
 *
 * Scans and redacts strings for known secret formats before they reach
 * argv, stderr, exception messages, subprocess arguments, or any other
 * output boundary.
 *
 * This is NOT a cryptographic guarantee — it is a coarse filter that
 * catches accidental plaintext exposures. The pattern set covers:
 * - Hex tokens (128/256-bit)
 * - API keys (OpenAI, Anthropic, generic sk-*)
 * - JWT tokens (header.payload.signature)
 * - Base64-encoded secrets (40+ chars)
 * - DPAPI-encrypted hex blobs
 * - PEM private key blocks
 * - GitHub/GitLab/AWS access keys
 */

// ── Pattern definitions ──

const SECRET_PATTERNS: readonly {
  name: string;
  regex: RegExp;
}[] = [
  { name: "hex256-token", regex: /\b[0-9a-fA-F]{64}\b/ },
  { name: "hex128-token", regex: /\b[0-9a-fA-F]{32}\b/ },
  { name: "openai-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/ },
  { name: "aws-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: "base64-secret", regex: /\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
  { name: "dpapi-blob", regex: /\b[0-9a-fA-F]{200,}\b/ },
  { name: "pem-private-key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "generic-api-key", regex: /\b(?:api[_-]?key|apikey|secret[_-]?key)["\s:=]+["']?[A-Za-z0-9_-]{20,}["']?/i },
];

// ── Public API ──

export interface ScanResult {
  hasSecrets: boolean;
  matchedPatterns: string[];
  matchCount: number;
}

/**
 * Scan a string for synthetic-secret patterns.
 * Returns a ScanResult describing potential leakage found.
 */
export function scanForSecrets(text: string): ScanResult {
  const matchedPatterns: string[] = [];
  let matchCount = 0;

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const matches = text.match(pattern.regex);
    if (matches && matches.length > 0) {
      matchedPatterns.push(pattern.name);
      matchCount += matches.length;
    }
  }

  return {
    hasSecrets: matchedPatterns.length > 0,
    matchedPatterns,
    matchCount,
  };
}

/**
 * Full-mode redaction: replace ALL secret-like patterns with [REDACTED:type].
 * Iterates until the string stabilizes — handles cases where one replacement
 * reveals another pattern, and ensures multiple same-type secrets are all
 * replaced (regex global flag handles same-type; iteration handles cross-type).
 *
 * Used before any string reaches stderr, exception messages, argv, or logs.
 */
export function safeStringForOutput(value: unknown): string {
  if (typeof value !== "string") {
    return String(value);
  }

  let result = value;
  let changed = true;
  // Iterate until stable — one pattern's replacement might reveal another
  while (changed) {
    changed = false;
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      const before = result;
      result = result.replace(pattern.regex, `[REDACTED:${pattern.name}]`);
      if (result !== before) changed = true;
    }
  }

  return result;
}

/**
 * Guard: throw sanitized Error if text contains secret-like content.
 * The error message itself is pre-scanned and contains no secret material.
 */
export function assertNoSecrets(text: string, channel: string): void {
  const result = scanForSecrets(text);
  if (result.hasSecrets) {
    throw new Error(
      `Secret-like content detected in ${channel}: ` +
      `${result.matchCount} match(es) for patterns: ${result.matchedPatterns.join(", ")}. ` +
      `The content has been suppressed to prevent leakage.`,
    );
  }
}

/**
 * Sanitize a string for stderr output: scan, redact if needed, write.
 * Returns true if the message was clean, false if redaction was applied.
 */
export function safeWriteStderr(message: string): boolean {
  const result = scanForSecrets(message);
  if (result.hasSecrets) {
    const redacted = safeStringForOutput(message);
    process.stderr.write(`[sestina:redacted] ${redacted}\n`);
    return false;
  }
  process.stderr.write(`${message}\n`);
  return true;
}

/**
 * Sanitize command-line arguments for subprocess execution.
 * Each argument is individually scanned; any argument containing
 * secret-like patterns is replaced with "[REDACTED]".
 */
export function sanitizeArgs(args: readonly string[]): string[] {
  return args.map((arg) => {
    const result = scanForSecrets(arg);
    return result.hasSecrets ? "[REDACTED]" : arg;
  });
}
