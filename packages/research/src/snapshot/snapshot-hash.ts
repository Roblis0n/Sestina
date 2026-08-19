import { isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { stableResearchHash } from "../identity/canonical-json.js";
import { err } from "../result.js";
import type { ResearchResult } from "../result.js";

export function calculateResearchSnapshotHash(snapshot: unknown): ResearchResult<string> {
  if (!isRecord(snapshot)) return err(researchError("invalid_research_snapshot"));
  const descriptors = Object.getOwnPropertyDescriptors(snapshot);
  delete descriptors.hash;
  const payload = Object.defineProperties({}, descriptors);
  return stableResearchHash(payload);
}
