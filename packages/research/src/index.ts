/**
 * Public API of @sestina/research.
 *
 * Consumers must import from the package root only; internal modules are
 * not part of the contract.
 */
export { researchError } from "./errors.js";
export type { ResearchError, ResearchErrorDetails, ResearchErrorCode } from "./errors.js";

export { ok, err } from "./result.js";
export type { ResearchResult } from "./result.js";

export type { Clock } from "./clock.js";

export {
  RESEARCH_ID_PREFIXES,
  parseResearchId,
  parseResearchIdFor,
  isResearchId,
  isResearchIdFor,
} from "./identity/research-id.js";
export type { ResearchIdPrefix, ResearchId, ParsedResearchId } from "./identity/research-id.js";

export {
  initialEntityVersion,
  parseEntityVersion,
  advanceEntityVersion,
} from "./identity/entity-version.js";
export type { EntityVersion } from "./identity/entity-version.js";

export { canonicalStringify, stableResearchHash } from "./identity/canonical-json.js";

export { validateResearchActor } from "./authority/actor.js";
export type { ResearchActor, ResearchActorKind } from "./authority/actor.js";

export {
  AUTHORITY_LEVELS,
  isAuthorityLevel,
  actorKindForAuthority,
  actorMatchesAuthority,
  validateAuthorityTransition,
} from "./authority/authority-level.js";
export type { AuthorityLevel } from "./authority/authority-level.js";

export {
  validateUtcTimestamp,
  parseResearchSource,
} from "./authority/source.js";
export type { ResearchSource } from "./authority/source.js";

export { confirmResearchSource } from "./authority/confirmation.js";
export type { ConfirmedSource } from "./authority/confirmation.js";

export { FixedClock, SequenceIdFactory } from "./testing/fakes.js";

import type { ResearchIdPrefix } from "./identity/research-id.js";

export interface IdFactory {
  create(prefix: ResearchIdPrefix): string;
}
