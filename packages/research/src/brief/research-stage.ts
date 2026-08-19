import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type ResearchStage =
  | "question_formulation"
  | "literature_review"
  | "data_collection"
  | "analysis"
  | "writing"
  | "revision"
  | "review_response";

export const RESEARCH_STAGES: readonly ResearchStage[] = [
  "question_formulation",
  "literature_review",
  "data_collection",
  "analysis",
  "writing",
  "revision",
  "review_response",
];

export function parseResearchStage(
  value: unknown,
): ResearchResult<ResearchStage> {
  return typeof value === "string" &&
    RESEARCH_STAGES.includes(value as ResearchStage)
    ? ok(value as ResearchStage)
    : err(researchError("invalid_research_stage"));
}
