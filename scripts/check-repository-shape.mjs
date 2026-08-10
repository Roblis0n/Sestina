#!/usr/bin/env node

/**
 * check-repository-shape.mjs
 *
 * Validates the Sestina monorepo structure.
 * Exit 0 on pass, exit 1 on any failure (errors to stderr).
 *
 * Checks performed:
 *   1. Root config files exist
 *   2. pnpm-workspace.yaml declares the three required globs
 *   3. packages/, apps/, integrations/ directories exist
 *   4. No package in apps/ or integrations/ imports from another app/integration
 *   5. OpenMythos-main (1)/ is NOT listed as a workspace package
 *   6. Every subdirectory under packages/ has a package.json whose name starts with @sestina/
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Resolve the repository root (two levels up from this script)
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let errors = 0;

function err(msg) {
  process.stderr.write(`[FAIL] ${msg}\n`);
  errors += 1;
}

function ok(msg) {
  process.stderr.write(`[OK]   ${msg}\n`);
}

function fileExists(relativePath) {
  return existsSync(resolve(ROOT, relativePath));
}

function readYamlWorkspace() {
  const raw = readFileSync(resolve(ROOT, "pnpm-workspace.yaml"), "utf8");
  const lines = raw.split("\n").filter((l) => {
    const trimmed = l.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  });

  // Collect quoted strings in the `packages:` array
  const globs = [];
  let inPackages = false;
  for (const line of lines) {
    const trimmed = line.trim();
    // Top-level keys start at column 0 (no leading whitespace)
    if (/^\S/.test(line)) {
      if (trimmed.startsWith("packages:")) {
        inPackages = true;
      } else {
        inPackages = false; // another top-level key — stop collecting
      }
      continue;
    }
    if (inPackages) {
      const match = trimmed.match(/^-\s*["'](.+?)["']/);
      if (match) {
        globs.push(match[1]);
      }
    }
  }
  return globs;
}

function dirsUnder(relativePath) {
  const full = resolve(ROOT, relativePath);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/**
 * Walk a directory tree, yielding every file path (relative to ROOT, posix-style).
 */
function* walkFiles(relativeDir) {
  const full = resolve(ROOT, relativeDir);
  if (!existsSync(full)) return;
  const entries = readdirSync(full, { withFileTypes: true });
  for (const entry of entries) {
    const rel = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkFiles(rel);
    } else {
      yield rel;
    }
  }
}

/**
 * Extract bare-specifier imports from a TS/JS file.
 * Very simple: matches lines like `import ... from '...'` or `from "..."`.
 */
function extractImports(filePath) {
  const src = readFileSync(resolve(ROOT, filePath), "utf8");
  const regex = /from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const deps = new Set();
  let m;
  while ((m = regex.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (spec) deps.add(spec);
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Check 1 — root config files
// ---------------------------------------------------------------------------
const REQUIRED_ROOT_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vitest.workspace.ts",
  "eslint.config.mjs",
  ".npmrc",
  ".node-version",
];

process.stderr.write("=== Check 1: Root config files ===\n");
for (const f of REQUIRED_ROOT_FILES) {
  if (fileExists(f)) {
    ok(f);
  } else {
    err(`Missing root config file: ${f}`);
  }
}

// ---------------------------------------------------------------------------
// Check 2 — pnpm-workspace.yaml declares the correct globs
// ---------------------------------------------------------------------------
process.stderr.write("\n=== Check 2: pnpm-workspace.yaml globs ===\n");
const REQUIRED_GLOBS = ["packages/*", "apps/*", "integrations/*"];

let workspaceGlobs = [];
if (fileExists("pnpm-workspace.yaml")) {
  workspaceGlobs = readYamlWorkspace();
  for (const g of REQUIRED_GLOBS) {
    if (workspaceGlobs.includes(g)) {
      ok(`workspace glob declared: ${g}`);
    } else {
      err(`Missing workspace glob: ${g}`);
    }
  }
} else {
  // Already reported in check 1
  err("Cannot read pnpm-workspace.yaml (file missing)");
}

// ---------------------------------------------------------------------------
// Check 3 — directories exist
// ---------------------------------------------------------------------------
process.stderr.write("\n=== Check 3: Required directories ===\n");
const REQUIRED_DIRS = ["packages", "apps", "integrations"];

for (const d of REQUIRED_DIRS) {
  const full = resolve(ROOT, d);
  if (existsSync(full) && statSync(full).isDirectory()) {
    ok(`${d}/ exists`);
  } else {
    if (existsSync(full)) {
      err(`${d}/ exists but is not a directory`);
    } else {
      err(`${d}/ directory is missing`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4 — No cross-imports between apps and integrations
// ---------------------------------------------------------------------------
process.stderr.write("\n=== Check 4: Cross-imports between apps/integrations ===\n");

// Collect the package names declared in apps/ and integrations/
function readPackageName(dir) {
  const pj = resolve(ROOT, dir, "package.json");
  if (!existsSync(pj)) return null;
  try {
    const json = JSON.parse(readFileSync(pj, "utf8"));
    return json.name || null;
  } catch {
    return null;
  }
}

const appDirs = dirsUnder("apps");
const integrationDirs = dirsUnder("integrations");

// Build a map of import-spec → which package it belongs to
const appNames = new Map(); // package-name → directory-basename
const integrationNames = new Map();

for (const d of appDirs) {
  const name = readPackageName(`apps/${d}`);
  if (name) appNames.set(name, d);
}
for (const d of integrationDirs) {
  const name = readPackageName(`integrations/${d}`);
  if (name) integrationNames.set(name, d);
}

function checkCrossImports(categoryDir, categoryLabel, siblingNames, ownNames) {
  const dirs = dirsUnder(categoryDir);
  for (const d of dirs) {
    const packageDir = `${categoryDir}/${d}`;
    for (const fileRel of walkFiles(packageDir)) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(fileRel)) continue;
      const imports = extractImports(fileRel);
      for (const imp of imports) {
        // Only care about bare specifiers that match a sibling package name
        if (siblingNames.has(imp)) {
          // Also disallow importing your own package name (sanity check)
          const ownName = readPackageName(packageDir);
          if (imp === ownName) continue; // self-import is fine

          err(
            `${fileRel} imports "${imp}" — cross-import between ${categoryLabel} packages is forbidden`
          );
        }
      }
    }
  }
}

const allAppNamesSet = new Set(appNames.keys());
const allIntegrationNamesSet = new Set(integrationNames.keys());

checkCrossImports("apps", "apps/", allIntegrationNamesSet, appNames);
checkCrossImports("integrations", "integrations/", allAppNamesSet, integrationNames);

// Also check that no two apps import each other, and no two integrations import each other
checkCrossImports("apps", "apps/", allAppNamesSet, appNames);
checkCrossImports("integrations", "integrations/", allIntegrationNamesSet, integrationNames);

if (appDirs.length === 0 && integrationDirs.length === 0) {
  ok("No app or integration packages to check for cross-imports");
}

// ---------------------------------------------------------------------------
// Check 5 — OpenMythos-main (1)/ is NOT a workspace package
// ---------------------------------------------------------------------------
process.stderr.write("\n=== Check 5: OpenMythos-main (1)/ exclusion ===\n");

const FORBIDDEN_OPENMYTHOS = "OpenMythos-main (1)";

// Check that no workspace glob matches it, and that the directory itself is not
// explicitly listed if it exists.
if (existsSync(resolve(ROOT, FORBIDDEN_OPENMYTHOS))) {
  // Walk each workspace glob and see if it expands to include the forbidden dir
  // Because apps/* and packages/* would not match "OpenMythos-main (1)" literally,
  // we simply check if the forbidden name appears as a workspace entry.
  const found = workspaceGlobs.some((g) => {
    // Check if removing wildcard and trailing /* yields a prefix that matches
    const prefix = g.replace(/\*+$/, "").replace(/\/$/, "");
    const fullForbidden = resolve(ROOT, FORBIDDEN_OPENMYTHOS);
    const fullPrefix = resolve(ROOT, prefix);
    try {
      // If the forbidden dir is inside a workspace-globbed directory
      return fullForbidden.startsWith(fullPrefix);
    } catch {
      return false;
    }
  });

  if (found) {
    // More precise check: the dir is NOT inside the workspace directories
    // Actually the real concern is that it shouldn't be a workspace package.
    // Check: is it inside packages/, apps/, or integrations/?
    err(
      `"${FORBIDDEN_OPENMYTHOS}/" should not be a workspace package, but it matches a workspace glob`
    );
  } else {
    ok(`"${FORBIDDEN_OPENMYTHOS}/" is not a workspace package`);
  }
} else {
  ok(`"${FORBIDDEN_OPENMYTHOS}/" does not exist (no issue)`);
}

// ---------------------------------------------------------------------------
// Check 6 — packages/*/package.json must have name starting with @sestina/
// ---------------------------------------------------------------------------
process.stderr.write("\n=== Check 6: @sestina/ package naming ===\n");

const packageDirs = dirsUnder("packages");

if (packageDirs.length === 0) {
  err("No packages found under packages/");
} else {
  for (const d of packageDirs) {
    const pjPath = resolve(ROOT, "packages", d, "package.json");
    if (!existsSync(pjPath)) {
      err(`packages/${d}/ missing package.json`);
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pjPath, "utf8"));
    } catch (e) {
      err(`packages/${d}/package.json is not valid JSON: ${e.message}`);
      continue;
    }
    if (!pkg.name) {
      err(`packages/${d}/package.json has no "name" field`);
    } else if (!pkg.name.startsWith("@sestina/")) {
      err(
        `packages/${d}/package.json name is "${pkg.name}" — must start with @sestina/`
      );
    } else {
      ok(`${pkg.name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
process.stderr.write("\n========================================\n");
if (errors > 0) {
  process.stderr.write(`[RESULT] ${errors} error(s) found\n`);
  process.exit(1);
} else {
  process.stderr.write("[RESULT] All checks passed\n");
  process.exit(0);
}
