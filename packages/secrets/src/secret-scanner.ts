/**
 * Defense-in-depth scanner for secret material crossing an output boundary.
 * Pattern matches and exact caller-supplied values are both supported.
 */
import { SestinaError, SestinaErrorCode } from "@sestina/schema";

const SECRET_PATTERNS: readonly {
  name: string;
  regex: RegExp;
}[] = [
  { name: "dpapi-blob", regex: /\b[0-9a-fA-F]{200,}\b/g },
  { name: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "hex256-token", regex: /\b[0-9a-fA-F]{64}\b/g },
  { name: "hex128-token", regex: /\b[0-9a-fA-F]{32}\b/g },
  { name: "openai-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  {
    name: "github-token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
  },
  { name: "aws-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  { name: "base64-secret", regex: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g },
  {
    name: "pem-private-key",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "generic-api-key",
    regex:
      /\b(?:api[_-]?key|apikey|secret[_-]?key)["\s:=]+["']?[A-Za-z0-9_-]{20,}["']?/gi,
  },
];

export interface ScanResult {
  hasSecrets: boolean;
  matchedPatterns: string[];
  matchCount: number;
}

export interface SecretScanOptions {
  /** Exact secret values already known to the caller. Empty values are ignored. */
  knownSecrets?: readonly string[];
}

interface SecretMatch {
  start: number;
  end: number;
  name: string;
  priority: number;
}

function findSecretMatches(
  text: string,
  options: SecretScanOptions,
): SecretMatch[] {
  const candidates: SecretMatch[] = [];
  const knownSecrets = [...new Set(options.knownSecrets ?? [])].filter(
    (secret) => secret.length > 0,
  );

  for (const secret of knownSecrets) {
    let start = 0;
    while (start <= text.length - secret.length) {
      const found = text.indexOf(secret, start);
      if (found === -1) break;
      candidates.push({
        start: found,
        end: found + secret.length,
        name: "known-secret",
        priority: -1,
      });
      start = found + secret.length;
    }
  }

  SECRET_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      if (match[0].length === 0) continue;
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        name: pattern.name,
        priority,
      });
    }
  });

  candidates.sort(
    (a, b) =>
      a.start - b.start ||
      a.priority - b.priority ||
      b.end - b.start - (a.end - a.start),
  );

  const selected: SecretMatch[] = [];
  let coveredUntil = -1;
  for (const candidate of candidates) {
    if (candidate.start < coveredUntil) continue;
    selected.push(candidate);
    coveredUntil = candidate.end;
  }
  return selected;
}

export function scanForSecrets(
  text: string,
  options: SecretScanOptions = {},
): ScanResult {
  const matches = findSecretMatches(text, options);
  return {
    hasSecrets: matches.length > 0,
    matchedPatterns: [...new Set(matches.map((match) => match.name))],
    matchCount: matches.length,
  };
}

export function safeStringForOutput(
  value: unknown,
  options: SecretScanOptions = {},
): string {
  const text = typeof value === "string" ? value : String(value);

  const matches = findSecretMatches(text, options);
  if (matches.length === 0) return text;

  let cursor = 0;
  const output: string[] = [];
  for (const match of matches) {
    output.push(text.slice(cursor, match.start), `[REDACTED:${match.name}]`);
    cursor = match.end;
  }
  output.push(text.slice(cursor));
  return output.join("");
}

export function assertNoSecrets(
  text: string,
  channel: string,
  options: SecretScanOptions = {},
): void {
  const result = scanForSecrets(text, options);
  if (result.hasSecrets) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `Secret-like content detected in ${channel}: ` +
        `${result.matchCount} match(es) for patterns: ${result.matchedPatterns.join(", ")}. ` +
        "The content has been suppressed to prevent leakage.",
    );
  }
}

export function safeWriteStderr(
  message: string,
  options: SecretScanOptions = {},
): boolean {
  const result = scanForSecrets(message, options);
  if (result.hasSecrets) {
    process.stderr.write(
      `[sestina:redacted] ${safeStringForOutput(message, options)}\n`,
    );
    return false;
  }
  process.stderr.write(`${message}\n`);
  return true;
}

export function sanitizeArgs(
  args: readonly string[],
  options: SecretScanOptions = {},
): string[] {
  return args.map((arg) =>
    scanForSecrets(arg, options).hasSecrets ? "[REDACTED]" : arg,
  );
}
