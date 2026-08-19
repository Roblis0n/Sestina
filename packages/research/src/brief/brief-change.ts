import type { ResearchActor } from "../authority/actor.js";
import type { ResearchSource } from "../authority/source.js";
import type { ResearchBriefVersionFields } from "./research-brief.js";

export type BriefChangeStatus = "pending" | "confirmed";
export type BriefChangeSet = Partial<ResearchBriefVersionFields>;

export interface BriefChangeProposal {
  readonly id: string;
  readonly briefId: string;
  readonly baseVersionId: string;
  readonly changes: BriefChangeSet;
  readonly diffFields: readonly string[];
  readonly reason: string;
  readonly source: ResearchSource;
  readonly createdAt: string;
  readonly status: BriefChangeStatus;
  readonly confirmedBy?: ResearchActor;
  readonly confirmedAt?: string;
  readonly activatedVersionId?: string;
}

export interface CreateBriefChangeProposalInput {
  readonly changes: BriefChangeSet;
  readonly reason: string;
  readonly source: ResearchSource;
}
