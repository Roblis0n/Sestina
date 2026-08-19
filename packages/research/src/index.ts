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

export {
  createResearchProject,
  updateResearchProject,
  parseResearchProject,
} from "./project/research-project.js";
export type {
  ResearchProject,
  CreateResearchProjectInput,
  UpdateResearchProjectInput,
} from "./project/research-project.js";

export { ARTIFACT_KINDS, parseArtifactKind } from "./artifact/artifact-kind.js";
export type { ArtifactKind } from "./artifact/artifact-kind.js";
export {
  contentReferenceForInline,
  parseContentReference,
} from "./artifact/content-reference.js";
export type {
  ContentReference,
  ResearchMediaType,
} from "./artifact/content-reference.js";
export {
  createArtifactRevision,
  parseArtifactRevision,
  rebuildArtifactRevisionChain,
} from "./artifact/artifact-revision.js";
export type {
  ArtifactRevision,
  CreateArtifactRevisionInput,
} from "./artifact/artifact-revision.js";
export {
  createResearchArtifact,
  parseResearchArtifact,
  addArtifactRevision,
  chooseArtifactBranch,
  tombstoneResearchArtifact,
  getArtifactRevision,
} from "./artifact/research-artifact.js";
export type {
  ResearchArtifact,
  ArtifactTombstone,
} from "./artifact/research-artifact.js";

export { RESEARCH_STAGES, parseResearchStage } from "./brief/research-stage.js";
export type { ResearchStage } from "./brief/research-stage.js";
export {
  parseScopeRule,
  normalizedScopeTargetKey,
  findScopeRuleConflict,
} from "./brief/scope-rule.js";
export type {
  ScopeRule,
  ScopeTarget,
  ScopeOperation,
} from "./brief/scope-rule.js";
export { parseExpectedDelta } from "./brief/expected-delta.js";
export type { ExpectedDelta } from "./brief/expected-delta.js";
export { parseEvidenceBoundaryRule } from "./brief/evidence-boundary-rule.js";
export type {
  EvidenceBoundaryRule,
  ForbiddenInferenceKind,
} from "./brief/evidence-boundary-rule.js";
export type {
  BriefChangeStatus,
  BriefChangeSet,
  BriefChangeProposal,
  CreateBriefChangeProposalInput,
} from "./brief/brief-change.js";
export {
  createResearchBrief,
  parseResearchBrief,
  parseResearchBriefVersion,
  createBriefChangeProposal,
  confirmBriefChangeProposal,
  getActiveResearchBriefVersion,
  getResearchBriefVersion,
  exportResearchBriefYaml,
} from "./brief/research-brief.js";
export type {
  BriefConstraint,
  ResearchBriefVersionFields,
  ResearchBriefInput,
  ResearchBriefVersion,
  ResearchBrief,
} from "./brief/research-brief.js";

import type { ResearchIdPrefix } from "./identity/research-id.js";

export interface IdFactory {
  create(prefix: ResearchIdPrefix): string;
}
