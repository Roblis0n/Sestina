import type { Clock } from "../clock.js";
import { cloneFrozen, isNonBlankString, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { parseRevisionEpisode, type RevisionEpisode } from "../episode/revision-episode.js";
import { validateUtcTimestamp } from "../authority/source.js";
import { calculateResearchSnapshotHash } from "./snapshot-hash.js";

export interface ResearchSnapshot {
  readonly id: string;
  readonly episodeId: string;
  readonly projectId: string;
  readonly episode: RevisionEpisode;
  readonly buildVersion: string;
  readonly limitations: readonly string[];
  readonly createdAt: string;
  readonly hashMeaning: "content_integrity_only";
  readonly hash: string;
}

function parseLimitations(input: unknown): ResearchResult<readonly string[]> {
  if (!Array.isArray(input)) return err(researchError("invalid_research_snapshot"));
  const values: string[] = [];
  for (const value of input) { if (!isNonBlankString(value)) return err(researchError("invalid_research_snapshot")); values.push(value.trim()); }
  return ok(cloneFrozen(values));
}

function parseSnapshotStructure(input: unknown): ResearchResult<ResearchSnapshot> {
  if (!isRecord(input) || !isNonBlankString(input.buildVersion) || input.hashMeaning !== "content_integrity_only" || typeof input.hash !== "string" || !/^[0-9a-f]{64}$/.test(input.hash)) return err(researchError("invalid_research_snapshot"));
  const id = parseResearchIdFor(input.id, "rsnp_"); if (!id.ok) return id;
  const episodeId = parseResearchIdFor(input.episodeId, "repi_"); if (!episodeId.ok) return episodeId;
  const projectId = parseResearchIdFor(input.projectId, "rprj_"); if (!projectId.ok) return projectId;
  const episode = parseRevisionEpisode(input.episode); if (!episode.ok) return episode;
  if (episode.value.id !== episodeId.value.id || episode.value.projectId !== projectId.value.id || !["candidate_submitted", "accepted", "rejected", "abandoned"].includes(episode.value.status)) return err(researchError("invalid_research_snapshot"));
  const limitations = parseLimitations(input.limitations); if (!limitations.ok) return limitations;
  const createdAt = validateUtcTimestamp(input.createdAt); if (!createdAt.ok) return createdAt;
  return ok(cloneFrozen({ id: id.value.id, episodeId: episodeId.value.id, projectId: projectId.value.id, episode: episode.value, buildVersion: input.buildVersion.trim(), limitations: limitations.value, createdAt: createdAt.value, hashMeaning: "content_integrity_only" as const, hash: input.hash }));
}

export function parseResearchSnapshot(input: unknown): ResearchResult<ResearchSnapshot> {
  const snapshot = parseSnapshotStructure(input); if (!snapshot.ok) return snapshot;
  const calculated = calculateResearchSnapshotHash(snapshot.value); if (!calculated.ok) return calculated;
  return calculated.value === snapshot.value.hash ? snapshot : err(researchError("snapshot_hash_mismatch"));
}

export function createResearchSnapshot(episodeInput: RevisionEpisode, input: { readonly buildVersion: string; readonly limitations: readonly string[] }, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchSnapshot> {
  const episode = parseRevisionEpisode(episodeInput); if (!episode.ok) return episode;
  if (!["accepted", "rejected", "abandoned"].includes(episode.value.status) || !isRecord(input) || !isNonBlankString(input.buildVersion)) return err(researchError("invalid_research_snapshot"));
  const limitations = parseLimitations(input.limitations); if (!limitations.ok) return limitations;
  const id = parseResearchIdFor(ports.idFactory.create("rsnp_"), "rsnp_"); if (!id.ok) return id;
  const at = readClock(ports.clock); if (!at.ok) return at;
  const withoutHash = { id: id.value.id, episodeId: episode.value.id, projectId: episode.value.projectId, episode: episode.value, buildVersion: input.buildVersion.trim(), limitations: limitations.value, createdAt: at.value, hashMeaning: "content_integrity_only" as const };
  const hash = calculateResearchSnapshotHash(withoutHash); if (!hash.ok) return hash;
  return parseResearchSnapshot({ ...withoutHash, hash: hash.value });
}

/**
 * Creates the immutable input anchor required before a deterministic review.
 * It is deliberately distinct from createResearchSnapshot: this snapshot
 * proves only which candidate-submitted state was reviewed and is not a final
 * user disposition or semantic-completion receipt.
 */
export function createReviewInputSnapshot(episodeInput: RevisionEpisode, input: { readonly buildVersion: string; readonly limitations: readonly string[] }, ports: { readonly clock: Clock; readonly idFactory: IdFactory }): ResearchResult<ResearchSnapshot> {
  const episode = parseRevisionEpisode(episodeInput); if (!episode.ok) return episode;
  if (episode.value.status !== "candidate_submitted" || !isRecord(input) || !isNonBlankString(input.buildVersion)) return err(researchError("invalid_research_snapshot"));
  const limitations = parseLimitations(input.limitations); if (!limitations.ok) return limitations;
  const id = parseResearchIdFor(ports.idFactory.create("rsnp_"), "rsnp_"); if (!id.ok) return id;
  const at = readClock(ports.clock); if (!at.ok) return at;
  const withoutHash = { id: id.value.id, episodeId: episode.value.id, projectId: episode.value.projectId, episode: episode.value, buildVersion: input.buildVersion.trim(), limitations: limitations.value, createdAt: at.value, hashMeaning: "content_integrity_only" as const };
  const hash = calculateResearchSnapshotHash(withoutHash); if (!hash.ok) return hash;
  return parseResearchSnapshot({ ...withoutHash, hash: hash.value });
}

export function verifyResearchSnapshotHash(input: unknown): ResearchResult<boolean> {
  const snapshot = parseSnapshotStructure(input); if (!snapshot.ok) return snapshot;
  const calculated = calculateResearchSnapshotHash(snapshot.value); if (!calculated.ok) return calculated;
  return ok(calculated.value === snapshot.value.hash);
}

export function rebuildEpisodeFromSnapshot(input: unknown): ResearchResult<RevisionEpisode> {
  const snapshot = parseResearchSnapshot(input); if (!snapshot.ok) return snapshot;
  return parseRevisionEpisode(snapshot.value.episode);
}
