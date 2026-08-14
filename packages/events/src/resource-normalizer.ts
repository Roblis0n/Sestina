import { RAW_EVENT_LIMITS } from "./limits.js";
import { sha256Hex } from "./idempotency.js";

// ── Path normalization ─────────────────────────────────────────────────────
//
// Rules (the spec; mirrored in test/paths.test.ts):
// - Windows-form paths (backslash separators anywhere, drive letters, UNC
//   //server/share, and \\?\ or \??\ device prefixes) are case-folded and
//   separator-normalized; POSIX-form paths keep their case (Linux is
//   case-sensitive). Windows drive letters are uppercased.
// - `.` and `..` segments are collapsed lexically. Leading `..` on relative
//   paths is preserved (resolving it would require the filesystem).
// - Symlink/junction RESULT paths are normalized textually only: this
//   package never touches the filesystem, so it cannot resolve symlinks.
//   Callers who need canonical (realpath) identity must supply it — the
//   limitation is honest, not silently ignored.
// - Cross-OS aliasing of one file (C:\x on Windows vs /mnt/c/x in WSL) is
//   NOT unified — the host's own spelling is the only ground truth here.

function looksLikeWindowsPath(path: string): boolean {
  return (
    path.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("//")
  );
}

export function normalizePathText(path: string): string {
  if (path.length === 0) {
    return path;
  }
  const windows = looksLikeWindowsPath(path);
  // A bare drive designator means "current directory on C:" — normalizing it
  // to "C:/" would claim the drive root, so it passes through uppercased.
  if (/^[A-Za-z]:$/.test(path)) {
    return path.toUpperCase();
  }
  let p = path.replace(/\\/g, "/");
  // Device path prefixes (\\?\C:\..., \??\C:\..., //?/C:/...) are Windows
  // artifacts of the host's own spelling — strip and treat as the drive path.
  if (p.startsWith("//?/") || p.startsWith("/??/")) {
    p = p.replace(/^\/\/\?\//, "").replace(/^\/\?\?\//, "");
    // \\?\UNC\server\share device-UNC form -> //server/share
    if (/^UNC\//i.test(p)) {
      p = p.replace(/^UNC\//i, "//");
    } else if (!/^[A-Za-z]:\//.test(p) && !p.startsWith("//")) {
      p = `//${p}`;
    }
  }
  // UNC is detected BEFORE segment filtering: //server/share/... starts with
  // exactly two slashes. A single-slash POSIX path must never be mistaken
  // for UNC (/// triple-slash also falls through to the absolute branch).
  const isUnc = p.startsWith("//") && !p.startsWith("///");

  const segments = p.split("/").filter((segment, index) => {
    if (segment !== "") {
      return true;
    }
    // Only a leading empty segment (absolute path) survives; duplicate
    // separators elsewhere collapse.
    return index === 0;
  });

  let root = "";
  let rest: string[];
  const first = segments[0];
  if (isUnc && (segments[1] ?? "") !== "" && (segments[2] ?? "") !== "") {
    // UNC: //server/share/...
    root = `//${(segments[1] ?? "").toLowerCase()}/${(segments[2] ?? "").toLowerCase()}/`;
    rest = segments.slice(3);
  } else if (first !== undefined && /^[A-Za-z]:$/.test(first)) {
    root = `${first.toUpperCase()}/`;
    rest = segments.slice(1);
  } else if (first === "") {
    root = "/";
    rest = segments.slice(1);
  } else {
    rest = segments;
  }

  const out: string[] = [];
  for (const segment of rest) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
        continue;
      }
      if (root !== "") {
        // Cannot climb above the root.
        continue;
      }
      out.push("..");
      continue;
    }
    out.push(windows ? segment.toLowerCase() : segment);
  }

  const joined = out.join("/");
  if (root === "") {
    return joined === "" ? "." : joined;
  }
  return root + joined;
}

// ── Resource candidate extraction ──────────────────────────────────────────
//
// Only path-shaped FIELDS of the tool input are collected; command and
// prompt text is never parsed for paths (a documented limitation — a shell
// command may reference files the normalizer cannot see).

const SHALLOW_PATH_KEYS = [
  "file_path",
  "path",
  "directory",
  "notebook_path",
  "planFilePath",
  "filePath",
] as const;

const APPLY_PATCH_MARKER = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;

function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

/**
 * Stricter structural check for the generic MCP/unknown-tool scan. A
 * leading "/" alone is NOT enough — user content like
 * "/please review the alice incident" is not a path. Candidates must have
 * a drive letter, a UNC/device prefix, or a leading separator followed by
 * another separator, a file extension, or a trailing separator.
 */
function isLikelyPath(value: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return true;
  }
  if (/^[\\/]{2}/.test(value)) {
    return true;
  }
  if (!/^[\\/]/.test(value)) {
    return false;
  }
  const rest = value.slice(1);
  return (
    /[\\/]/.test(rest) ||
    /\.[A-Za-z0-9]{1,10}$/.test(rest) ||
    /[\\/]$/.test(value)
  );
}

/**
 * Collect the raw path strings a tool call references, in a host-independent
 * way. Relative paths are resolved textually against the event cwd.
 */
export function collectResourcePathCandidates(
  toolName: string,
  toolInput: unknown,
  cwd?: string,
): string[] {
  if (typeof toolInput !== "object" || toolInput === null) {
    return [];
  }
  const input = toolInput as Record<string, unknown>;
  const found: string[] = [];

  const pushString = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0) {
      found.push(value);
    }
  };

  switch (toolName) {
    case "Bash":
    case "PowerShell":
      // No command parsing — the command text is opaque to the normalizer.
      return [];
    case "apply_patch": {
      // Two shapes: codex exec stream FileChange items carry changes[]; the
      // hook stdin carries the patch text with fixed *** (Update|Add|Delete)
      // File: markers. Only those markers are parsed — never hunk contents.
      const changes = input.changes;
      if (Array.isArray(changes)) {
        for (const change of changes) {
          if (typeof change === "object" && change !== null) {
            pushString((change as Record<string, unknown>).path);
          }
        }
        return resolveCandidates(found, cwd);
      }
      if (typeof input.command === "string") {
        for (const line of input.command.split(/\r?\n/)) {
          const match = APPLY_PATCH_MARKER.exec(line.trim());
          if (match?.[1] !== undefined) {
            found.push(match[1].trim());
          }
        }
      }
      return resolveCandidates(found, cwd);
    }
    case "Write":
    case "Edit":
    case "Read":
    case "NotebookEdit": {
      const key = toolName === "NotebookEdit" ? "notebook_path" : "file_path";
      pushString(input[key]);
      return resolveCandidates(found, cwd);
    }
    case "Glob":
    case "Grep":
      pushString(input.path);
      return resolveCandidates(found, cwd);
    case "ExitPlanMode":
      pushString(input.planFilePath);
      return resolveCandidates(found, cwd);
    case "WebFetch":
    case "WebSearch":
    case "Agent":
      // URLs and prompts are not file resources.
      return [];
    default: {
      // MCP tools (mcp__server__tool) and unknown local tools: first the
      // path-shaped keys, then any string argument that already looks like an
      // absolute path (MCP arguments are arbitrary JSON; this is a structural
      // scan, not content sniffing).
      for (const key of SHALLOW_PATH_KEYS) {
        pushString(input[key]);
      }
      if (found.length === 0) {
        for (const value of Object.values(input)) {
          if (typeof value === "string" && isLikelyPath(value)) {
            found.push(value);
          }
        }
      }
      return resolveCandidates(found, cwd);
    }
  }
}

function resolveCandidates(paths: string[], cwd: string | undefined): string[] {
  if (cwd === undefined || cwd.length === 0) {
    return paths;
  }
  return paths.map((path) => (isAbsolutePath(path) ? path : `${cwd}/${path}`));
}

// ── Resource normalization ─────────────────────────────────────────────────

export interface NormalizedResourcePath {
  /** Normalized path text (Windows case/separators unified). */
  normalized: string;
  /**
   * sha256 (hex) of the ORIGINAL path spelling — kept available so
   * governance can still match the host's exact text even after
   * normalization.
   */
  originalHash: string;
}

export async function normalizeResourcePaths(
  paths: readonly string[],
): Promise<NormalizedResourcePath[]> {
  const result: NormalizedResourcePath[] = [];
  for (const path of paths) {
    result.push({
      normalized: normalizePathText(path),
      originalHash: await sha256Hex(new TextEncoder().encode(path)),
    });
  }
  return result;
}

export interface HostActionCandidate {
  toolName: string;
  toolInput: unknown;
  cwd?: string;
  /** Optional structural status note (e.g. "status failed"), never content. */
  statusNote?: string;
}

export interface NormalizedActionCandidate extends HostActionCandidate {
  /** Normalized path refs (capped at RAW_EVENT_LIMITS.maxResourceRefs). */
  resourceRefs: string[];
  /** normalized path -> sha256 hex of the original spelling. */
  originalPathHashes: ReadonlyMap<string, string>;
  /** Serialized character count of the tool input (a count, not content). */
  inputChars: number;
}

/**
 * Normalize the resource paths of an action candidate: collect candidates
 * from the tool input, normalize their text, cap the ref count, and keep the
 * original spellings' hashes available. No payload is stored — only refs,
 * hashes, and character counts.
 */
export async function normalizeResources(
  candidate: HostActionCandidate,
): Promise<NormalizedActionCandidate> {
  const rawPaths = collectResourcePathCandidates(
    candidate.toolName,
    candidate.toolInput,
    candidate.cwd,
  );
  const normalized = await normalizeResourcePaths(rawPaths);
  const capped = normalized.slice(0, RAW_EVENT_LIMITS.maxResourceRefs);
  const hashes = new Map<string, string>();
  for (const entry of capped) {
    hashes.set(entry.normalized, entry.originalHash);
  }
  return {
    ...candidate,
    resourceRefs: capped.map((entry) => entry.normalized),
    originalPathHashes: hashes,
    inputChars: serializedLength(candidate.toolInput),
  };
}

function serializedLength(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized.length : 0;
  } catch {
    return 0;
  }
}
