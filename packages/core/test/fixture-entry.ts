// Explicit test resolution only. Frozen legacy fixture recipes retain their
// original imports and behavior; this entry is absent from desktop artifacts.
export * from "../src/index.js";
export { openSestina, SestinaCore } from "../src/sestina-core.js";
export function legacyFixtureWritesEnabled(): boolean { return true; }
