/**
 * Authority levels and the actor kinds allowed to hold them. The pairing
 * table is the single source of truth: model, system and import actors can
 * never hold user authority.
 */
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import type { ResearchActor, ResearchActorKind } from "./actor.js";
import { parseResearchSource, type ResearchSource } from "./source.js";

export type AuthorityLevel =
  | "user_confirmed"
  | "user_recorded"
  | "model_proposed"
  | "system_derived"
  | "imported_unconfirmed";

export const AUTHORITY_LEVELS: readonly AuthorityLevel[] = [
  "user_confirmed",
  "user_recorded",
  "model_proposed",
  "system_derived",
  "imported_unconfirmed",
];

const ACTOR_KIND_FOR_AUTHORITY: Readonly<Record<AuthorityLevel, ResearchActorKind>> = {
  user_confirmed: "user",
  user_recorded: "user",
  model_proposed: "model",
  system_derived: "system",
  imported_unconfirmed: "import",
};

export function isAuthorityLevel(value: unknown): value is AuthorityLevel {
  return (
    typeof value === "string" && AUTHORITY_LEVELS.includes(value as AuthorityLevel)
  );
}

export function actorKindForAuthority(level: AuthorityLevel): ResearchActorKind {
  return ACTOR_KIND_FOR_AUTHORITY[level];
}

/** True when the actor kind is legal for the authority level. */
export function actorMatchesAuthority(
  actor: ResearchActor,
  authority: AuthorityLevel,
): boolean {
  return actor.kind === ACTOR_KIND_FOR_AUTHORITY[authority];
}

function isUserAuthority(level: AuthorityLevel): boolean {
  return level === "user_confirmed" || level === "user_recorded";
}

/**
 * Validate an authority transition.
 *
 * Rules:
 * - both sides must be internally legal (pairing + fields);
 * - anything a user confirmed or recorded can only be superseded by
 *   another user-level source; model, system and import actors can never
 *   overwrite user authority.
 */
export function validateAuthorityTransition(
  current: ResearchSource,
  incoming: ResearchSource,
): ResearchResult<void> {
  const incomingCheck = parseResearchSource(incoming);
  if (!incomingCheck.ok) return incomingCheck;
  const currentCheck = parseResearchSource(current);
  if (!currentCheck.ok) return currentCheck;

  if (
    isUserAuthority(currentCheck.value.authority) &&
    !isUserAuthority(incomingCheck.value.authority)
  ) {
    return err(
      researchError("authority_conflict", {
        currentAuthority: currentCheck.value.authority,
        incomingAuthority: incomingCheck.value.authority,
      }),
    );
  }
  return ok(undefined);
}
