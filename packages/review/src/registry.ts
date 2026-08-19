import type { ResearchChecker } from "./checker.js";

function valid(value: unknown): value is ResearchChecker {
  if (typeof value !== "object" || value === null) return false;
  const checker = value as Record<string, unknown>;
  return typeof checker.id === "string" && checker.id.trim().length > 0 && typeof checker.version === "string" && checker.version.trim().length > 0 && (checker.kind === "deterministic" || checker.kind === "semantic") && typeof checker.supports === "function" && typeof checker.run === "function";
}

export class CheckerRegistry {
  readonly #checkers: readonly ResearchChecker[];
  constructor(checkers: readonly ResearchChecker[]) {
    const keys = new Set<string>();
    for (const checker of checkers) {
      if (!valid(checker)) throw new Error("invalid checker");
      const key = `${checker.id}\u0000${checker.version}`;
      if (keys.has(key)) throw new Error("duplicate checker ID/version");
      keys.add(key);
    }
    this.#checkers = Object.freeze([...checkers].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version)));
  }
  list(): readonly ResearchChecker[] { return this.#checkers; }
  get(id: string, version: string): ResearchChecker | undefined { return this.#checkers.find((checker) => checker.id === id && checker.version === version); }
}
