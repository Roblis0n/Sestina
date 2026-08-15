import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CompileContractInput } from "../src/compiler.js";

// Fixtures live outside the package root, so they are loaded at runtime
// (repo:check forbids relative imports that escape the package root).
const FIXTURES = resolve(import.meta.dirname, "../../../tests/fixtures/contracts");

export function loadContractFixture(name: string): CompileContractInput {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as CompileContractInput;
}
