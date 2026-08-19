import { cloneFrozen, isRecord } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export interface EpisodeOutcome {
  readonly fulfillment: "met" | "unmet" | "unknown";
  readonly evidence: "proven" | "unproven" | "stale" | "disputed";
  readonly scope: "compliant" | "violated" | "unknown";
  readonly decisionIntegrity: "preserved" | "violated" | "unknown";
  readonly issueIntegrity: "preserved" | "repeated" | "unknown";
  readonly userDisposition: "pending" | "accepted" | "rejected" | "waived";
}

const VALUES = {
  fulfillment: ["met", "unmet", "unknown"],
  evidence: ["proven", "unproven", "stale", "disputed"],
  scope: ["compliant", "violated", "unknown"],
  decisionIntegrity: ["preserved", "violated", "unknown"],
  issueIntegrity: ["preserved", "repeated", "unknown"],
  userDisposition: ["pending", "accepted", "rejected", "waived"],
} as const;

export type WaivableOutcomeDimension = Exclude<keyof EpisodeOutcome, "userDisposition">;

export function parseEpisodeOutcome(input: unknown): ResearchResult<EpisodeOutcome> {
  if (!isRecord(input)) return err(researchError("invalid_episode_outcome"));
  for (const [key, allowed] of Object.entries(VALUES)) {
    if (!(allowed as readonly unknown[]).includes(input[key])) return err(researchError("invalid_episode_outcome"));
  }
  return ok(cloneFrozen({
    fulfillment: input.fulfillment as EpisodeOutcome["fulfillment"],
    evidence: input.evidence as EpisodeOutcome["evidence"],
    scope: input.scope as EpisodeOutcome["scope"],
    decisionIntegrity: input.decisionIntegrity as EpisodeOutcome["decisionIntegrity"],
    issueIntegrity: input.issueIntegrity as EpisodeOutcome["issueIntegrity"],
    userDisposition: input.userDisposition as EpisodeOutcome["userDisposition"],
  }));
}
