import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type ArtifactKind =
  | "manuscript"
  | "section"
  | "interview"
  | "codebook"
  | "dataset"
  | "analysis"
  | "review_response"
  | "research_note";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "manuscript",
  "section",
  "interview",
  "codebook",
  "dataset",
  "analysis",
  "review_response",
  "research_note",
];

export function parseArtifactKind(
  value: unknown,
): ResearchResult<ArtifactKind> {
  return typeof value === "string" &&
    ARTIFACT_KINDS.includes(value as ArtifactKind)
    ? ok(value as ArtifactKind)
    : err(researchError("invalid_artifact_kind"));
}
