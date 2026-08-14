import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { deriveDeterministicId } from "@sestina/events";

// ── Project identity (docs/30 §3/§4) ──
// Bindings carry a content-independent identity: the canonical path plus,
// when the user supplied it, the Git remote. The stored `fingerprint` is the
// strongest stable identity available — the remote fingerprint when a remote
// exists (so a moved root can be re-associated across paths), otherwise the
// path fingerprint (which still unifies case-variant spellings on
// case-insensitive platforms). Never derived from file contents.

export interface RootFingerprint {
  /** Resolved, separator-normalized, case-normalized path. */
  canonicalPath: string;
  gitRemote: string;
  caseSemantics: "case_insensitive" | "case_sensitive";
  /** sha256("path\u0000" + canonicalPath) — same-path identity. */
  pathFingerprint: string;
  /** Remote fingerprint when gitRemote is set, else the path fingerprint. */
  fingerprint: string;
}

function hashFingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * The platform default for case folding (docs/30 §3): Windows and macOS
 * default volumes fold case, Linux does not. Injectable for tests so the
 * semantics are asserted per platform instead of per runner.
 */
export function platformDefaultCaseInsensitive(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" || platform === "darwin";
}

export function canonicalizeRootPath(
  rootPath: string,
  caseInsensitive: boolean = platformDefaultCaseInsensitive(),
): string {
  const normalized = resolve(rootPath).replaceAll("\\", "/");
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function computeRootFingerprint(
  rootPath: string,
  opts: { gitRemote?: string; caseInsensitive?: boolean } = {},
): RootFingerprint {
  const caseInsensitive = opts.caseInsensitive ?? platformDefaultCaseInsensitive();
  const canonicalPath = canonicalizeRootPath(rootPath, caseInsensitive);
  const gitRemote = opts.gitRemote ?? "";
  const pathFingerprint = hashFingerprint(`path\u0000${canonicalPath}`);
  const fingerprint =
    gitRemote !== "" ? hashFingerprint(`remote\u0000${gitRemote}`) : pathFingerprint;
  return {
    canonicalPath,
    gitRemote,
    caseSemantics: caseInsensitive ? "case_insensitive" : "case_sensitive",
    pathFingerprint,
    fingerprint,
  };
}

/**
 * Derives the project id from a binding fingerprint — deterministic and
 * never containing path plaintext (docs/30 §3).
 */
export async function deriveProjectId(fingerprintInput: string): Promise<string> {
  return deriveDeterministicId("project", fingerprintInput);
}

/** Short human alias of a canonical root path ("D:/work/repo" → "repo"). */
export function rootAlias(canonicalPath: string): string {
  const segments = canonicalPath.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return "/";
  return segments[segments.length - 1] ?? "/";
}
