import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type EpisodeStatus = "draft" | "active" | "candidate_submitted" | "reviewed" | "user_action_required" | "accepted" | "rejected" | "abandoned";
export const EPISODE_STATUSES: readonly EpisodeStatus[] = ["draft", "active", "candidate_submitted", "reviewed", "user_action_required", "accepted", "rejected", "abandoned"];
export function parseEpisodeStatus(value: unknown): ResearchResult<EpisodeStatus> {
  return typeof value === "string" && EPISODE_STATUSES.includes(value as EpisodeStatus)
    ? ok(value as EpisodeStatus)
    : err(researchError("invalid_episode_status"));
}
