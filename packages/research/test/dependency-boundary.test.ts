/**
 * RI-09: dependency and side-effect boundary of @sestina/research.
 *
 * The domain package must be importable without touching the filesystem,
 * environment, database or network, must not import legacy governance
 * packages, and must not read the wall clock or randomness from inside
 * its own source. These are enforced as a source-level scan plus a real
 * import of the package root.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as research from "../src/index.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      files.push(...collectSourceFiles(abs));
    } else if (entry.endsWith(".ts")) {
      files.push(abs);
    }
  }
  return files;
}

const FORBIDDEN_PATTERNS: readonly { re: RegExp; label: string }[] = [
  {
    re: /@sestina\/(config|secrets|storage|events|projects|contracts|evidence)\b/,
    label: "legacy governance package import",
  },
  { re: /\bnode:(fs|os|process|child_process|worker_threads|net|http|https|sqlite)\b/, label: "Node side-effect import" },
  { re: /process\.env/, label: "environment variable access" },
  { re: /Date\.now\(\s*\)/, label: "wall-clock read (use the Clock port)" },
  { re: /new Date\(\s*\)/, label: "wall-clock construction (use the Clock port)" },
  { re: /performance\.now\(\s*\)/, label: "performance clock read" },
  { re: /Math\.random\(\s*\)/, label: "non-deterministic randomness" },
];

describe("package root import", () => {
  it("imports without side effects and exposes a public surface", () => {
    expect(Object.keys(research).length).toBeGreaterThan(0);
  });
});

describe("source boundary scan", () => {
  it("contains no forbidden imports, env access, wall-clock or randomness", () => {
    const files = collectSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      for (const { re, label } of FORBIDDEN_PATTERNS) {
        expect(
          re.test(text),
          `${file} contains ${label}`,
        ).toBe(false);
      }
    }
  });
});
