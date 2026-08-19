#!/usr/bin/env node

/**
 * verify-clean-package.mjs
 *
 * Strict-mode package hygiene for NEW product packages. The eight legacy
 * packages are explicitly exempt (they stay governed by
 * check-repository-shape.mjs); historical gaps there must not block RI-03,
 * and new packages never inherit the legacy exemption.
 *
 * A strict package that does not exist yet is not an error: this check
 * activates the moment the directory appears.
 *
 * Exit 0 on pass, exit 1 on any violation (errors to stderr).
 *
 * Usage: node scripts/verify-clean-package.mjs [--root <path>]
 *
 * Rule IDs (docs/architecture/01-DEPENDENCY-RULES.md):
 *   PKG-R001 parsable package.json with a valid @sestina/* name
 *   PKG-R002 type === "module"
 *   PKG-R003 private === true (until publishing is explicitly approved)
 *   PKG-R004 exports["."] declared
 *   PKG-R005 root export target exists on disk
 *   PKG-R006 at least one of test/build/typecheck scripts declared
 *   PKG-R007 no database/WAL/log/key/backup assets inside the package
 *   PKG-R008 workspace dependencies stay inside the architecture allowlist
 *   PKG-R009 no deep @sestina/* subpath imports bypassing public exports
 *   PKG-R010 no personal absolute paths inside package sources
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

// ── Strict-mode package set and the dependency allowlist ──
// The allowlist mirrors verify-architecture.mjs NEW_PACKAGE_RULES; keep both
// in sync (single source of truth is docs/architecture/01-DEPENDENCY-RULES.md).
const STRICT_PACKAGES = {
  "packages/research": ["schema"],
  "packages/research-store": ["research", "review", "schema", "storage"],
  "packages/review": ["research", "schema"],
  "packages/reports": ["research", "review", "schema"],
  "packages/core": [
    "research",
    "research-store",
    "review",
    "reports",
    "storage",
    "config",
    "secrets",
    "schema",
  ],
  "apps/cli": ["core"],
  "integrations/mcp": ["core"],
  "integrations/legacy-import": [
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
};

const FORBIDDEN_ASSET_RE =
  /\.(db|sqlite|sqlite3|log|key|pem|bak|backup|wal)(-[a-z0-9]+)*$/i;
const PERSONAL_PATH_RE = /[A-Za-z]:\\Users\\/i;
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
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

function collectFiles(dir, acc = []) {
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
      collectFiles(abs, acc);
    } else {
      acc.push(abs);
    }
  }
  return acc;
}

function stripComments(source) {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function extractSpecifiers(source) {
  const text = stripComments(source);
  const specs = new Set();
  const patterns = [
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s+(?:type\s+)?[\w*$\s{},]*?\bfrom\s+["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[\w*$\s{},]*?\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      specs.add(m[1]);
    }
  }
  return [...specs];
}

// ── Strict checks ──
const checked = [];

for (const [pkgDir, allow] of Object.entries(STRICT_PACKAGES)) {
  const absPkgDir = resolve(ROOT, pkgDir);
  if (!existsSync(absPkgDir)) continue;
  let st;
  try {
    st = statSync(absPkgDir);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  checked.push(pkgDir);

  // PKG-R001: parsable manifest with a valid scoped name.
  const manifestPath = join(absPkgDir, "package.json");
  let manifest = null;
  if (!existsSync(manifestPath)) {
    err(`[PKG-R001] ${pkgDir}: package.json is missing`);
    continue;
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    err(`[PKG-R001] ${pkgDir}: package.json is not valid JSON (${e.message})`);
    continue;
  }
  if (
    typeof manifest.name !== "string" ||
    !/^@sestina\/[a-z0-9-]+$/.test(manifest.name)
  ) {
    err(
      `[PKG-R001] ${pkgDir}: package name '${manifest.name}' is not a valid @sestina/* name`,
    );
    continue;
  }

  // PKG-R002: ESM only.
  if (manifest.type !== "module") {
    err(
      `[PKG-R002] ${pkgDir}: type is '${manifest.type}'; new packages must declare "type": "module"`,
    );
  }

  // PKG-R003: private until publishing is approved.
  if (manifest.private !== true) {
    err(
      `[PKG-R003] ${pkgDir}: "private": true is required until publishing is explicitly approved`,
    );
  }

  // PKG-R004 / PKG-R005: root export declared and present on disk.
  const rootExport = manifest.exports && manifest.exports["."];
  if (typeof rootExport !== "string") {
    err(
      `[PKG-R004] ${pkgDir}: exports["."] is missing; new packages must expose a public root entry`,
    );
  } else if (!existsSync(resolve(absPkgDir, rootExport))) {
    err(
      `[PKG-R005] ${pkgDir}: exports["."] target '${rootExport}' does not exist on disk`,
    );
  }

  // PKG-R006: at least one verification entry point.
  const scripts = manifest.scripts ?? {};
  const hasGate = ["test", "build", "typecheck"].some((s) => typeof scripts[s] === "string");
  if (!hasGate) {
    err(
      `[PKG-R006] ${pkgDir}: declare at least one of scripts.test / scripts.build / scripts.typecheck (or document root-level coverage)`,
    );
  }

  // PKG-R008: workspace dependencies inside the architecture allowlist.
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = manifest[field] ?? {};
    for (const [name, version] of Object.entries(deps)) {
      if (!name.startsWith("@sestina/")) continue;
      const short = name.slice("@sestina/".length);
      if (!allow.includes(short)) {
        err(
          `[PKG-R008] ${pkgDir}: ${field} declares '${name}@${version}' which is outside the architecture allowlist (${allow
            .map((a) => `@sestina/${a}`)
            .join(", ")})`,
        );
      }
    }
  }

  // Asset and source hygiene.
  const files = collectFiles(absPkgDir);
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    // PKG-R007: forbidden asset files anywhere in the package.
    if (FORBIDDEN_ASSET_RE.test(rel.slice(pkgDir.length + 1))) {
      err(
        `[PKG-R007] ${rel}: forbidden package asset (database/WAL/log/key/backup); runtime artifacts must never live inside a package`,
      );
      continue;
    }
    const dot = file.lastIndexOf(".");
    const ext = dot === -1 ? "" : file.slice(dot).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // PKG-R009: deep subpath imports bypassing public exports.
    for (const spec of extractSpecifiers(source)) {
      if (/^@sestina\/[^/]+\/.+/.test(spec)) {
        err(
          `[PKG-R009] ${rel}: deep import '${spec}' bypasses the public exports of @sestina/${spec.split("/")[1]}; import the package root instead`,
        );
      }
    }
    // PKG-R010: personal absolute paths in sources.
    if (PERSONAL_PATH_RE.test(source)) {
      err(
        `[PKG-R010] ${rel}: contains a personal absolute path (user directory); package sources must stay machine-independent`,
      );
    }
  }
  ok(`${pkgDir}: strict package hygiene checked`);
}

if (checked.length === 0) {
  ok("no strict-mode (new product) packages present yet; legacy packages are exempt");
} else {
  ok(`strict packages checked: ${checked.join(", ")}`);
}

if (errors > 0) {
  process.stderr.write(`\n[RESULT] ${errors} package hygiene violation(s) found\n`);
  process.exit(1);
}
process.stderr.write(`[RESULT] All package hygiene checks passed\n`);
process.exit(0);
