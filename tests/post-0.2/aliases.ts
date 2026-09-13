import { resolve } from "node:path";

export const aliases = Object.fromEntries(["core", "research", "research-store", "storage", "schema", "review", "secrets"].map((name) => [
  `@sestina/${name}`, resolve(name === "core" ? "packages/core/test/fixture-entry.ts" : `packages/${name}/src/index.ts`),
]));
