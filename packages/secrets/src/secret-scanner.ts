/**
 * Synthetic-secret scanner — defense-in-depth against secret leakage.
 *
 * Scans strings for patterns that match known secret formats before
 * they reach argv, stderr, exception messages, or other output channels.
 *
 * This is NOT a cryptographic guarantee — it's a coarse filter that
 * catches accidental plaintext exposures of hex tokens, API keys,
 * and other identifiable secret formats.
 */

// ── Pattern definitions ──

/** Patterns that match common secret formats. */
const SECRET_PATTERNS: readonly {
  name: string;
  regex: RegExp;
}[] = [
  // 256-bit hex tokens (64 hex chars) — control tokens
  { name: "hex256-token", regex: /\b[0-9a-fA-F]{64}\b/ },
  // 128-bit hex (32 hex chars) — smaller tokens
  { name: "hex128-token", regex: /\b[0-9a-fA-F]{32}\b/ },
  // OpenAI-style API keys: sk-... or sk-proj-...
  { name: "openai-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  // Anthropic-style API keys: sk-ant-...
  { name: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  // JWT tokens: eyJ... (base64url header)
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  // Generic base64-encoded secrets (40+ chars of base64)
  { name: "base64-secret", regex: /\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
  // DPAPI hex blobs (200+ hex chars)
  { name: "dpapi-blob", regex: /\b[0-9a-fA-F]{200,}\b/ },
];

// ── Public API ──

/**
 * Result of scanning a string for potential secret leakage.
 */
export interface ScanResult {
  /** Whether any secret-like patterns were found. */
  hasSecrets: boolean;
  /** Which patterns matched (without the matched content). */
  matchedPatterns: string[];
  /** Number of matches found. */
  matchCount: number;
}

/**
 * Scan a string for synthetic-secret patterns.
 *
 * @param text  The string to scan (e.g., argv element, stderr output, error message).
 * @returns A ScanResult describing any potential secret leakage found.
 */
export function scanForSecrets(text: string): ScanResult {
  const matchedPatterns: string[] = [];
  let matchCount = 0;

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0; // reset global regex state
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
 * Safely convert a value to a string for output, redacting any
 * secret-like patterns found.
 *
 * @param value  The value that might contain secret material.
 * @param label  A label for the redacted content in output.
 * @returns A safe string with secret patterns replaced by [REDACTED].
 */
export function safeStringForOutput(value: unknown): string {
  if (typeof value !== "string") {
    return String(value);
  }

  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    result = result.replace(pattern.regex, `[REDACTED:${pattern.name}]`);
  }

  return result;
}

/**
 * Guard: throws if the given string resembles a secret.
 * Use before writing to argv-visible channels or stderr.
 *
 * @param text  The string to check.
 * @param channel  Description of the output channel (for error message).
 */
export function assertNoSecrets(text: string, channel: string): void {
  const result = scanForSecrets(text);
  if (result.hasSecrets) {
    throw new Error(
      `Secret-like content detected in ${channel}: ` +
      `${result.matchCount} match(es) for patterns: ${result.matchedPatterns.join(", ")}. ` +
      `This may indicate a secret leak. The content has been suppressed.`,
    );
  }
}
