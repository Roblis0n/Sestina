#!/usr/bin/env node
/**
 * Scan source files for placeholders that should not be in committed code.
 * Exits 0 if none found, exits 1 with the count printed to stderr otherwise.
 *
 * Usage: node scripts/check-no-placeholders.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// ── CLI: parse --root ──
const ARGV = process.argv.slice(2);
let ROOT = null;
for (let i = 0; i < ARGV.length; i++) {
  if (ARGV[i] === "--root" && i + 1 < ARGV.length) {
    ROOT = resolve(ARGV[i + 1]);
    break;
  }
}
if (!ROOT) {
  ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

// Patterns to search for (case-insensitive).  Order matches the spec.
const PATTERNS = [
  { name: "TODO",       regex: /TODO/gi },
  { name: "FIXME",      regex: /FIXME/gi },
  { name: "XXX",        regex: /XXX(?!\.)/gi },
  { name: "PLACEHOLDER", regex: /PLACEHOLDER/gi },
  { name: '"changeme"',  regex: /changeme/gi },
  { name: '"replaceme"', regex: /replaceme/gi },
  { name: '"temp_"',    regex: /temp_/gi },
  { name: '"stub_"',    regex: /stub_/gi },
  { name: '"WIP"',      regex: /WIP/gi },
  { name: '"TBD"',      regex: /TBD/gi },
];

// Directories to exclude (specs, test code, build outputs)
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".git",
  "docs",
  "tests",
  // Gitignored working notes (CLAUDE.md: keep resumption guides and research
  // notes there; they legitimately quote upstream docs and are never committed).
  ".tmp",
]);

// Files at the repo root to exclude (historical materials)
const EXCLUDE_ROOT_FILES = new Set([
  "handoff.md",
  "方案详解.md",
  "未决.md",
  "招募合作者-未决.md",
  "结果.md",
  "HANDOFF-FOR-CLAUDE-CODE.md",
  "HANDOFF-FOR-NEXT-CONVERSATION.md",
  "pnpm-lock.yaml",
]);

// Path to this script itself — never scan it
const SELF_PATH = fileURLToPath(import.meta.url);

// File extensions to scan
const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".mjs",
  ".yaml",
  ".yml",
]);

/**
 * Returns true when any segment of `dirPath` matches a skipped directory
 * or the special "OpenMythos-main (1)" directory name.
 */
function isExcluded(dirPath) {
  const parts = dirPath.split(/[/\\]/);
  // Check if this is a package test directory: packages/<name>/test/
  const normalized = dirPath.replace(/\\/g, "/");
  if (/packages\/[^/]+\/test(\/|$)/.test(normalized)) return true;

  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part)) return true;
    if (part === "OpenMythos-main (1)") return true;
  }
  return false;
}

/**
 * Recursively collect every scannable file under `dir`, skipping excluded trees.
 */
function findFiles(dir, results = []) {
  if (isExcluded(dir)) return results;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // permission errors, dangling symlinks, etc. — skip silently
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    // Skip excluded root-level historical files
    if (dir === ROOT && entry.isFile() && EXCLUDE_ROOT_FILES.has(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      findFiles(fullPath, results);
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname(entry.name))) {
      // Skip this script itself
      if (fullPath === SELF_PATH) continue;
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Return the 1-based line number for the character offset `idx` in `text`.
 */
function lineNumber(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

function main() {
  const files = findFiles(ROOT);
  let findings = 0;

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // Pre-compute positions of "check-no-placeholders" to detect overlap
    const cnpPositions = [];
    if (content.includes("check-no-placeholders")) {
      const cnpRegex = /check-no-placeholders/gi;
      let cnpMatch;
      while ((cnpMatch = cnpRegex.exec(content)) !== null) {
        // Record the span of "placeholder" within "check-no-placeholders": chars 9-20
        cnpPositions.push({ start: cnpMatch.index + 9, end: cnpMatch.index + 20 });
      }
    }

    for (const { name, regex } of PATTERNS) {
      regex.lastIndex = 0; // reset global regex state
      let match;
      while ((match = regex.exec(content)) !== null) {
        const line = lineNumber(content, match.index);
        const text = match[0];

        // For the PLACEHOLDER pattern: only skip the specific "placeholder"
        // substring that is inside "check-no-placeholders". Other occurrences
        // of PLACEHOLDER on the same line (or nearby) must still be caught.
        if (name === "PLACEHOLDER") {
          const mStart = match.index;
          const mEnd = match.index + text.length;
          const overlapsCnp = cnpPositions.some(
            (pos) => mStart < pos.end && mEnd > pos.start,
          );
          if (overlapsCnp) continue;
        }

        // file path (repo-relative), line number, matched text
        console.error(`${relative(ROOT, file)}:${line}: ${text}`);
        findings++;
      }
    }
  }

  if (findings > 0) {
    console.error(`\n${findings} placeholder(s) found.`);
    process.exit(1);
  }

  // Success: nothing to stderr, exit 0
  process.exit(0);
}

main();
