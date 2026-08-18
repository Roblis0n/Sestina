/**
 * User confirmation primitive. Only a legal user actor can confirm a
 * proposal; the result is a new user_confirmed source that keeps a
 * reference to the confirmed proposal and never mutates its inputs.
 */
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { Clock } from "../clock.js";
import type { ResearchResult } from "../result.js";
import type { ResearchActor } from "./actor.js";
import { parseResearchSource, validateUtcTimestamp, type ResearchSource } from "./source.js";

export interface ConfirmedSource {
  /** The new user_confirmed source. */
  readonly source: ResearchSource;
  /** Reference to the proposal that was confirmed. */
  readonly confirmedProposal: ResearchSource;
  /** When the user confirmed, from the injected clock. */
  readonly confirmedAt: string;
}

export function confirmResearchSource(
  proposal: ResearchSource,
  confirmingActor: ResearchActor,
  clock: Clock,
): ResearchResult<ConfirmedSource> {
  const proposalCheck = parseResearchSource(proposal);
  if (!proposalCheck.ok) return proposalCheck;

  if (confirmingActor.kind !== "user") {
    return err(
      researchError("authority_conflict", { actorKind: confirmingActor.kind }),
    );
  }
  const actorCheck = parseResearchSource({
    actor: confirmingActor,
    authority: "user_confirmed",
    recordedAt: "1970-01-01T00:00:00.000Z",
  });
  if (!actorCheck.ok) return actorCheck;

  let instant: Date;
  try {
    instant = clock.now();
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
      return err(researchError("invalid_timestamp"));
    }
  } catch {
    return err(researchError("invalid_timestamp"));
  }

  const confirmedAt = validateUtcTimestamp(instant.toISOString());
  if (!confirmedAt.ok) return confirmedAt;

  return ok({
    source: {
      actor: actorCheck.value.actor,
      authority: "user_confirmed",
      recordedAt: confirmedAt.value,
    },
    confirmedProposal: proposalCheck.value,
    confirmedAt: confirmedAt.value,
  });
}
