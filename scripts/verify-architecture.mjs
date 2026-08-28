#!/usr/bin/env node

/**
 * verify-architecture.mjs
 *
 * Enforces the research-integrity dependency boundaries for all NEW product
 * packages (docs/architecture/01-DEPENDENCY-RULES.md). Legacy packages keep
 * their existing rules in check-repository-shape.mjs; they are exempt here
 * via the documented legacy allowlist and must never be imported by new
 * product packages.
 *
 * Exit 0 on pass, exit 1 on any violation (errors to stderr).
 *
 * Usage: node scripts/verify-architecture.mjs [--root <path>]
 *
 * Rule IDs:
 *   ARCH-R001 packages/research          -> @sestina/schema only (+ third-party)
 *   ARCH-R002 packages/research-store    -> research, review, schema, storage
 *   ARCH-R003 packages/review            -> research, schema; never
 *                                          research-store or storage
 *   ARCH-R004 packages/reports           -> research, review, schema
 *   ARCH-R011 packages/pilot             -> no @sestina/* dependencies
 *   ARCH-R005 packages/core              -> research, research-store, review,
 *                                          reports, storage, config, secrets, schema
 *   ARCH-R006 apps/cli                   -> core, mcp, skills
 *   ARCH-R012 apps/research-room         -> core + bounded mcp/host adapter
 *   ARCH-R007 integrations/mcp           -> @sestina/core only
 *   ARCH-R008 integrations/legacy-import -> read-only legacy boundary
 *                                          (legacy packages + mapping targets)
 *   ARCH-R009 new product packages must never import @sestina/events,
 *             @sestina/projects, @sestina/contracts, @sestina/evidence
 *   ARCH-R010 integrations/skills        -> no @sestina/* dependencies
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

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

// ── Boundary rules for new product packages ──
// Keys are workspace-relative package directories; "allow" lists the
// @sestina/* package names (without scope) that may be imported.
const NEW_PACKAGE_RULES = {
  "packages/research": {
    id: "ARCH-R001",
    allow: ["schema"],
    fix: "research must stay a pure domain package; only @sestina/schema and third-party libraries are allowed",
  },
  "packages/research-store": {
    id: "ARCH-R002",
    allow: ["research", "review", "schema", "storage"],
    fix: "research-store may only depend on research, review, schema and storage",
  },
  "packages/review": {
    id: "ARCH-R003",
    allow: ["research", "schema"],
    fix: "review must not access storage or research-store directly; persist findings through repository ports instead",
  },
  "packages/reports": {
    id: "ARCH-R004",
    allow: ["research", "review", "schema"],
    fix: "reports may only read research/review/schema state and must never depend on a store or change domain state",
  },
  "packages/core": {
    id: "ARCH-R005",
    allow: ["research", "research-store", "review", "reports", "storage", "config", "secrets", "schema"],
    fix: "core composes research-store, review, reports, storage, config and secrets; anything else belongs behind a port",
  },
  "apps/cli": {
    id: "ARCH-R006",
    allow: ["core", "mcp", "skills"],
    fix: "apps/cli may compose core plus the public MCP package locator and generated Skill artifacts; do not import storage, research-store, legacy packages, or package internals",
  },
  "integrations/mcp": {
    id: "ARCH-R007",
    allow: ["core"],
    fix: "integrations/mcp must reach business capabilities through @sestina/core only and must never import storage internals",
  },
  "apps/research-room": {
    id: "ARCH-R012",
    allow: ["core", "mcp"],
    testAllow: ["storage"],
    fix: "apps/research-room is a loopback presentation adapter; business capabilities go through @sestina/core and the bounded Codex process/MCP adapter goes through @sestina/mcp; direct storage access is limited to destructive migration fixtures under test/",
  },
  "packages/pilot": {
    id: "ARCH-R011",
    allow: [],
    fix: "pilot is an isolated RI-43 local recorder and must not depend on Sestina product runtime or domain packages",
  },
  "integrations/skills": {
    id: "ARCH-R010",
    allow: [],
    fix: "integrations/skills is a deterministic generation/host-adapter package and must not depend on Sestina business or runtime packages",
  },
  "integrations/legacy-import": {
    id: "ARCH-R008",
    allow: [
      "schema",
      "storage",
      "research",
      "research-store",
      "review",
      "reports",
      "events",
      "projects",
      "contracts",
      "evidence",
    ],
    fix: "legacy-import is the sole read-only legacy boundary and may only map legacy data into the new domain packages",
  },
};

// Legacy packages banned for every new product package except
// integrations/legacy-import (ARCH-R009).
const LEGACY_BANNED = ["events", "projects", "contracts", "evidence"];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

// ── Helpers ──
let errors = 0;

function err(msg) {
  process.stderr.write(`[FAIL] ${msg}\n`);
  errors += 1;
}

function ok(msg) {
  process.stderr.write(`[OK]   ${msg}\n`);
}

/** Collect source files under a directory, skipping build/vendor trees. */
function collectSourceFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectSourceFiles(abs, acc);
    } else {
      const dot = entry.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.slice(dot).toLowerCase();
      if (SOURCE_EXTENSIONS.has(ext)) acc.push(abs);
    }
  }
  return acc;
}

/** Strip block comments and full-line // comments before import scanning. */
function stripComments(source) {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Extract module specifiers from static, side-effect, dynamic and re-exports. */
function extractSpecifiers(source) {
  const text = stripComments(source);
  const specs = new Set();
  const patterns = [
    /\bimport\s+["']([^"']+)["']/g, // side-effect import
    /\bimport\s+(?:type\s+)?[\w*$\s{},]*?\bfrom\s+["']([^"']+)["']/g, // static
    /\bexport\s+(?:type\s+)?[\w*$\s{},]*?\bfrom\s+["']([^"']+)["']/g, // re-export
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import (literal)
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      specs.add(m[1]);
    }
  }
  return [...specs];
}

/** Map "@sestina/foo/bar" -> "foo"; returns null for non-@sestina specifiers. */
function sestinaPackageName(specifier) {
  if (!specifier.startsWith("@sestina/")) return null;
  const parts = specifier.split("/");
  // ["@sestina", "foo", ...] -> "foo"
  return parts.length >= 2 ? parts[1] : null;
}

// ── Check each new product package ──
const checkedPackages = [];

for (const [pkgDir, rule] of Object.entries(NEW_PACKAGE_RULES)) {
  const absPkgDir = resolve(ROOT, pkgDir);
  if (!existsSync(absPkgDir)) continue;
  let st;
  try {
    st = statSync(absPkgDir);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  if (!existsSync(join(absPkgDir, "package.json"))) continue;

  checkedPackages.push(pkgDir);
  const files = collectSourceFiles(absPkgDir);

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of extractSpecifiers(source)) {
      const dep = sestinaPackageName(spec);
      if (dep === null) continue;
      const relFile = relative(ROOT, file).split(sep).join("/");
      const allowed = relFile.startsWith(`${pkgDir}/test/`)
        ? [...rule.allow, ...(rule.testAllow ?? [])]
        : rule.allow;

      if (LEGACY_BANNED.includes(dep) && !allowed.includes(dep)) {
        err(
          `[${rule.id === "ARCH-R008" ? rule.id : "ARCH-R009"}] ${relFile} imports ${spec}; new product packages must not import legacy package @sestina/${dep} (only integrations/legacy-import may read legacy data)`,
        );
        continue;
      }
      if (!allowed.includes(dep)) {
        err(
          `[${rule.id}] ${relFile} imports ${spec}; ${rule.fix} (allowed here: ${allowed
            .map((a) => `@sestina/${a}`)
            .join(", ")})`,
        );
      }
    }
  }
  ok(`${pkgDir}: ${files.length} source file(s) scanned against ${rule.id}`);
}

if (checkedPackages.length === 0) {
  ok("no new product packages present yet; nothing to check beyond the legacy allowlist");
} else {
  ok(`checked new product packages: ${checkedPackages.join(", ")}`);
}

if (errors > 0) {
  process.stderr.write(
    `\n[RESULT] ${errors} architecture violation(s) found\n`,
  );
  process.exit(1);
}
process.stderr.write(`[RESULT] All architecture boundary checks passed\n`);
process.exit(0);
