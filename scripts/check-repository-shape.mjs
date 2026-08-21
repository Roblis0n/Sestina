#!/usr/bin/env node

/**
 * check-repository-shape.mjs
 *
 * Validates the Sestina monorepo structure.
 * Exit 0 on pass, exit 1 on any failure (errors to stderr).
 *
 * Usage: node scripts/check-repository-shape.mjs [--root <path>]
 *
 * Checks performed:
 *   1. Root config files exist
 *   2. pnpm-workspace.yaml declares the three required globs
 *   3. packages/, apps/, integrations/ directories exist
 *   4. No cross-imports between apps and integrations
 *   5. OpenMythos-main (1)/ is NOT in workspace
 *   6. Every package directory has valid @sestina/* package.json
 *   7. Public entry points exist with real exports
 *   8. Cross-package imports only reference full package names (no subpaths);
 *      relative imports must not escape the package root
 *   9. Renderer must not depend on core/storage/secrets/providers
 *  10. No unexpanded variables in release/artifacts/packaging manifests
 *  11. No NUL bytes in text-like tracked files (git would classify them binary)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, dirname, sep } from "node:path";
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

// ── Helpers ──
let errors = 0;

function err(msg) {
  process.stderr.write(`[FAIL] ${msg}\n`);
  errors += 1;
}

function ok(msg) {
  process.stderr.write(`[OK]   ${msg}\n`);
}

function fileExists(relPath) {
  return existsSync(resolve(ROOT, relPath));
}

// ── YAML parsing (pnpm-workspace.yaml) ──
function readYamlWorkspace() {
  const yamlPath = resolve(ROOT, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return [];
  const raw = readFileSync(yamlPath, "utf8");
  const lines = raw.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#");
  });
  const globs = [];
  let inPackages = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\S/.test(line)) {
      inPackages = trimmed.startsWith("packages:");
      continue;
    }
    if (inPackages) {
      const m = trimmed.match(/^-\s*["'](.+?)["']/);
      if (m) globs.push(m[1]);
    }
  }
  return globs;
}

// ── Directory listing ──
function dirsUnder(relPath) {
  const full = resolve(ROOT, relPath);
  if (!existsSync(full)) return [];
  try {
    return readdirSync(full, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ── Package metadata ──
function readPackageJson(relDir) {
  const pj = resolve(ROOT, relDir, "package.json");
  if (!existsSync(pj)) return null;
  try {
    return JSON.parse(readFileSync(pj, "utf8"));
  } catch {
    return null;
  }
}

function readPackageName(relDir) {
  const pj = readPackageJson(relDir);
  return pj?.name || null;
}

// ── File walking ──
const WALK_SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".pnpm-store",
  ".git",
  ".release-ri42-staging",
  "OpenMythos-main (1)",
]);

function* walkFiles(relDir) {
  const full = resolve(ROOT, relDir);
  if (!existsSync(full)) return;
  const base = relDir.split(/[/\\]/).pop();
  if (base && WALK_SKIP.has(base)) return;
  let entries;
  try {
    entries = readdirSync(full, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (WALK_SKIP.has(e.name)) continue;
      yield* walkFiles(`${relDir}/${e.name}`);
    } else if (e.isFile()) {
      yield `${relDir}/${e.name}`;
    }
  }
}

// ── Import extraction (static, side-effect, dynamic, export-from) ──
// Captures:
//   import 'foo'          → side-effect
//   import x from 'foo'   → static
//   import('foo')         → dynamic
//   export * from 'foo'   → re-export
//   export { x } from 'foo' → re-export
function extractImports(fileRel) {
  const full = resolve(ROOT, fileRel);
  try {
    const src = readFileSync(full, "utf8");
    const specs = new Set();
    // Side-effect import: import "..." or import '...'
    for (const m of src.matchAll(/import\s+['"]([^'"]+)['"]\s*;?/g)) {
      if (m[1]) specs.add(m[1]);
    }
    // Static import / export-from: from "..."
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (m[1]) specs.add(m[1]);
    }
    // Dynamic import: import("...") or import('...')
    for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (m[1]) specs.add(m[1]);
    }
    return specs;
  } catch {
    return new Set();
  }
}

// ── Resolve relative import to absolute path, detect if it escapes package ──
function relativeImportEscapesPackage(
  importingFileRel,
  importSpec,
  pkgRootRel,
) {
  if (!importSpec.startsWith(".")) return false; // not a relative import
  const fileDir = dirname(resolve(ROOT, importingFileRel));
  const resolved = resolve(fileDir, importSpec);
  const pkgRoot = resolve(ROOT, pkgRootRel);
  // Use path.relative to determine whether `resolved` stays inside `pkgRoot`.
  // If the result starts with `..`, the import escapes the package boundary.
  const rel = relative(pkgRoot, resolved);
  if (rel.startsWith(".." + sep) || rel === "..") return true;
  // Also check common extension / index resolutions
  const candidates = [
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.js`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      const relC = relative(pkgRoot, c);
      if (relC.startsWith(".." + sep) || relC === "..") return true;
    }
  }
  return false;
}

// ── Collect all package directories from packages/, apps/, integrations/ ──
function collectAllPackageDirs() {
  const result = [];
  for (const category of ["packages", "apps", "integrations"]) {
    const dirs = dirsUnder(category);
    for (const d of dirs) {
      const pkgDir = `${category}/${d}`;
      const name = readPackageName(pkgDir);
      if (name) {
        result.push({ dir: pkgDir, name, category });
      }
    }
  }
  return result;
}

// ── Build map from package name → package root directory ──
function buildPackageMap(allPkgs) {
  const map = new Map();
  for (const p of allPkgs) {
    map.set(p.name, p);
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 1 — Root config files
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("=== Check 1: Root config files ===\n");
const REQUIRED_ROOT_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vitest.config.ts",
  "eslint.config.mjs",
  ".npmrc",
  ".node-version",
];
for (const f of REQUIRED_ROOT_FILES) {
  fileExists(f) ? ok(f) : err(`Missing root config file: ${f}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 2 — pnpm-workspace.yaml globs
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 2: pnpm-workspace.yaml globs ===\n");
const REQUIRED_GLOBS = ["packages/*", "apps/*", "integrations/*"];
let workspaceGlobs = [];
if (fileExists("pnpm-workspace.yaml")) {
  workspaceGlobs = readYamlWorkspace();
  for (const g of REQUIRED_GLOBS) {
    workspaceGlobs.includes(g)
      ? ok(`workspace glob declared: ${g}`)
      : err(`Missing workspace glob: ${g}`);
  }
} else {
  err("Cannot read pnpm-workspace.yaml (file missing)");
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 3 — Required directories
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 3: Required directories ===\n");
for (const d of ["packages", "apps", "integrations"]) {
  const full = resolve(ROOT, d);
  if (existsSync(full) && statSync(full).isDirectory()) {
    ok(`${d}/ exists`);
  } else {
    err(`${d}/ directory is missing`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 4 — Cross-imports between apps/integrations
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write(
  "\n=== Check 4: Cross-imports between apps/integrations ===\n",
);
const allPkgs = collectAllPackageDirs();
const pkgMap = buildPackageMap(allPkgs);

const CROSS_CATEGORY_IMPORT_ALLOWLIST = new Map([
  ["@sestina/cli", new Set(["@sestina/mcp", "@sestina/skills"])],
]);

function checkCategoryCrossImports(catDir, catLabel, otherNames) {
  const dirs = dirsUnder(catDir);
  for (const d of dirs) {
    const pkgDir = `${catDir}/${d}`;
    const ownName = readPackageName(pkgDir);
    for (const f of walkFiles(pkgDir)) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(f)) continue;
      for (const imp of extractImports(f)) {
        if (otherNames.has(imp) && imp !== ownName && !CROSS_CATEGORY_IMPORT_ALLOWLIST.get(ownName)?.has(imp)) {
          err(
            `${f} imports "${imp}" — cross-import between ${catLabel} packages is forbidden`,
          );
        }
      }
    }
  }
}

const appNames = new Set();
const integrationNames = new Set();
for (const p of allPkgs) {
  if (p.category === "apps") appNames.add(p.name);
  else if (p.category === "integrations") integrationNames.add(p.name);
}

checkCategoryCrossImports("apps", "apps/", integrationNames);
checkCategoryCrossImports("apps", "apps/", appNames);
checkCategoryCrossImports("integrations", "integrations/", appNames);
checkCategoryCrossImports("integrations", "integrations/", integrationNames);

if (dirsUnder("apps").length === 0 && dirsUnder("integrations").length === 0) {
  ok("No app or integration packages to check for cross-imports");
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 5 — OpenMythos exclusion
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 5: OpenMythos-main (1)/ exclusion ===\n");
const FORBIDDEN = "OpenMythos-main (1)";
if (existsSync(resolve(ROOT, FORBIDDEN))) {
  const found = workspaceGlobs.some((g) => {
    const prefix = g.replace(/\*+$/, "").replace(/\/$/, "");
    try {
      return resolve(ROOT, FORBIDDEN).startsWith(resolve(ROOT, prefix));
    } catch {
      return false;
    }
  });
  found
    ? err(`"${FORBIDDEN}/" should not be a workspace package`)
    : ok(`"${FORBIDDEN}/" is not a workspace package`);
} else {
  ok(`"${FORBIDDEN}/" does not exist (no issue)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 6 — @sestina/ package naming
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 6: @sestina/ package naming ===\n");
const pkgsDirs = dirsUnder("packages");
if (pkgsDirs.length === 0) {
  err("No packages found under packages/");
} else {
  for (const d of pkgsDirs) {
    const pj = readPackageJson(`packages/${d}`);
    if (!pj) {
      err(`packages/${d}/ missing or invalid package.json`);
      continue;
    }
    if (!pj.name) {
      err(`packages/${d}/package.json has no "name" field`);
      continue;
    }
    if (!pj.name.startsWith("@sestina/")) {
      err(
        `packages/${d}/package.json name is "${pj.name}" — must start with @sestina/`,
      );
    } else {
      ok(pj.name);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 7 — Public entry points (real exports + package.json exports field)
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 7: Public exports ===\n");

// Detect real export keyword (not just "export" inside a comment or string)
function hasRealExports(content) {
  // Remove block comments
  const noBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments
  const lines = noBlockComments.split("\n");
  const noComments = lines
    .map((l) => {
      const commentIdx = l.indexOf("//");
      return commentIdx >= 0 ? l.slice(0, commentIdx) : l;
    })
    .join("\n");
  // Remove string literals (simple heuristic: anything between quotes)
  const noStrings = noComments
    .replace(/'[^']*'/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/`[^`]*`/g, "");
  // Now check for real export keyword
  return /\bexport\b/.test(noStrings);
}

for (const pkg of dirsUnder("packages")) {
  const pkgDir = `packages/${pkg}`;
  const pj = readPackageJson(pkgDir);
  if (!pj) continue;

  // A. Verify src/index.ts exists with real exports
  const indexPath = resolve(ROOT, pkgDir, "src", "index.ts");
  if (!existsSync(indexPath)) {
    err(`${pkgDir}/ missing public entry point src/index.ts`);
    continue;
  }
  const content = readFileSync(indexPath, "utf8");
  if (!hasRealExports(content)) {
    err(
      `${pkgDir}/src/index.ts has no real export statements (comment-only "export" not accepted)`,
    );
  } else {
    ok(`${pkgDir} has real public exports in src/index.ts`);
  }

  // B. Verify package.json exports field points to public entry
  if (!pj.exports) {
    err(`${pkgDir}/package.json missing "exports" field`);
  } else if (typeof pj.exports === "string") {
    // Single export
    if (
      !pj.exports.endsWith("src/index.ts") &&
      !pj.exports.endsWith("src/index.js")
    ) {
      err(
        `${pkgDir}/package.json exports "${pj.exports}" does not point to src/index`,
      );
    }
  } else if (typeof pj.exports === "object") {
    const dot = pj.exports["."];
    if (!dot) {
      err(`${pkgDir}/package.json exports missing "." entry`);
    } else {
      const dotPath =
        typeof dot === "string"
          ? dot
          : dot?.import || dot?.require || dot?.default || "";
      if (dotPath && !dotPath.includes("src/index")) {
        err(
          `${pkgDir}/package.json exports "." → "${dotPath}" does not point to src/index`,
        );
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 8 — Cross-package imports: no subpaths, no relative escapes
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 8: Cross-package boundary violations ===\n");

const allPkgDirs = collectAllPackageDirs();
const allNames = new Set(allPkgDirs.map((p) => p.name));
let boundaryErrors = 0;

for (const pkg of allPkgDirs) {
  for (const fileRel of walkFiles(pkg.dir)) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(fileRel)) continue;
    const imports = extractImports(fileRel);

    for (const imp of imports) {
      // ── Cross-package bare specifier checks ──
      if (imp.startsWith("@sestina/")) {
        // Self-reference is fine
        if (imp === pkg.name) continue;

        // Does it reference a known package?
        const slashIdx = imp.indexOf("/", "@sestina/".length);
        if (slashIdx >= 0) {
          // imp has a subpath: @sestina/foo/sub/path
          const targetPkg =
            "@sestina/" + imp.slice("@sestina/".length, slashIdx);
          if (allNames.has(targetPkg)) {
            // Known package with subpath — FORBIDDEN
            err(
              `${fileRel} imports "${imp}" — cross-package imports must use only the package name (no subpaths). Use "${targetPkg}" instead.`,
            );
            boundaryErrors++;
          }
          // Unknown package — fall through to general check
        }
        // Exact package name match is fine
      }

      // ── Relative imports that cross package roots ──
      if (imp.startsWith(".")) {
        if (relativeImportEscapesPackage(fileRel, imp, pkg.dir)) {
          err(
            `${fileRel} imports "${imp}" — relative import escapes package root "${pkg.dir}"`,
          );
          boundaryErrors++;
        }
      }
    }
  }
}

if (boundaryErrors === 0) {
  ok("No cross-package boundary violations detected");
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 9 — Renderer dependency restrictions
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 9: Renderer dependency restrictions ===\n");

const FORBIDDEN_RENDERER_DEPS = [
  "@sestina/core",
  "@sestina/storage",
  "@sestina/secrets",
  "@sestina/providers",
];

let rendererErrors = 0;
for (const pkg of allPkgDirs) {
  for (const fileRel of walkFiles(pkg.dir)) {
    if (!/[\/\\]renderer[\/\\]/.test(fileRel)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(fileRel)) continue;
    for (const imp of extractImports(fileRel)) {
      for (const forbidden of FORBIDDEN_RENDERER_DEPS) {
        if (imp === forbidden || imp.startsWith(forbidden + "/")) {
          err(
            `${pkg.dir}/${fileRel} imports "${imp}" — renderer must not depend on ${forbidden}`,
          );
          rendererErrors++;
        }
      }
    }
  }
}

if (rendererErrors === 0) {
  ok("No renderer dependency violations detected");
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 10 — No unexpanded variables in release/artifacts/packaging
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 10: Unexpanded variables ===\n");

const UNEXPANDED_PATTERNS = [/\$\{[A-Z_]+\}/, /\{\{.*?\}\}/, /<%.*?%>/];

let unexpandedErrors = 0;
function checkUnexpanded(dirRel) {
  if (!existsSync(resolve(ROOT, dirRel))) return;
  for (const fileRel of walkFiles(dirRel)) {
    if (
      !/\.(json|ya?ml|xml|toml|nsh|plist|desktop|cfg|ini|template)$/.test(
        fileRel,
      )
    )
      continue;
    try {
      const content = readFileSync(resolve(ROOT, fileRel), "utf8");
      for (const p of UNEXPANDED_PATTERNS) {
        const m = p.exec(content);
        if (m) {
          err(`${fileRel} contains unexpanded variable: ${m[0]}`);
          unexpandedErrors++;
          break;
        }
      }
    } catch {
      /* skip */
    }
  }
}

checkUnexpanded("release");
checkUnexpanded("artifacts");
checkUnexpanded("packaging");

if (unexpandedErrors === 0) {
  ok("No unexpanded variables detected in release/artifacts/packaging");
}

// ═══════════════════════════════════════════════════════════════════════════
// Check 11 — No NUL bytes in text-like tracked files
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n=== Check 11: NUL bytes in text-like files ===\n");

// Media/binary asset extensions that legitimately contain NUL bytes.
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "icns", "webp", "bmp", "tif", "tiff",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "wav", "ogg", "webm", "avi", "mov",
  "pdf", "zip", "gz", "tar", "bz2", "xz", "7z", "rar",
  "dll", "exe", "so", "dylib", "wasm", "node", "db", "sqlite",
  "snap", "asar", "pak",
]);

let nulErrors = 0;
// Git classifies a file as binary when a NUL appears within the first 8000
// bytes; scan that window only, mirroring git's own heuristic.
for (const fileRel of walkFiles(".")) {
  // Root release artifacts are generated, ignored binaries. Check 10 still
  // walks release manifests explicitly so template variables cannot escape.
  if (fileRel.startsWith("./release/")) continue;
  const ext = fileRel.split(".").pop()?.toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) continue;
  let buf;
  try {
    buf = readFileSync(resolve(ROOT, fileRel));
  } catch {
    continue;
  }
  const window = buf.subarray(0, Math.min(8000, buf.length));
  if (window.includes(0)) {
    err(
      `${fileRel} contains a NUL byte — git classifies the file as binary; remove it`,
    );
    nulErrors++;
  }
}

if (nulErrors === 0) {
  ok("No NUL bytes in text-like files");
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════
process.stderr.write("\n========================================\n");
if (errors > 0) {
  process.stderr.write(`[RESULT] ${errors} error(s) found\n`);
  process.exit(1);
} else {
  process.stderr.write("[RESULT] All checks passed\n");
  process.exit(0);
}
