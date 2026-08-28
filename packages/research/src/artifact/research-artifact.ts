import type { ResearchSource } from "../authority/source.js";
import { parseResearchSource, validateUtcTimestamp } from "../authority/source.js";
import type { Clock } from "../clock.js";
import {
  cloneFrozen,
  isNonBlankString,
  isRecord,
  readClock,
} from "../domain-validation.js";
import { researchError } from "../errors.js";
import {
  advanceEntityVersion,
  initialEntityVersion,
  parseEntityVersion,
  type EntityVersion,
} from "../identity/entity-version.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import { parseArtifactKind, type ArtifactKind } from "./artifact-kind.js";
import {
  parseArtifactRevision,
  type ArtifactRevision,
} from "./artifact-revision.js";

export interface ArtifactTombstone {
  readonly source: ResearchSource;
  readonly tombstonedAt: string;
}

export interface ResearchArtifact {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly source: ResearchSource;
  readonly version: EntityVersion;
  readonly createdAt: string;
  readonly activeRevisionId?: string;
  readonly branchHeads: readonly string[];
  readonly revisions: readonly ArtifactRevision[];
  readonly tombstone?: ArtifactTombstone;
}

export function parseResearchArtifact(
  input: unknown,
): ResearchResult<ResearchArtifact> {
  if (
    !isRecord(input) ||
    !isNonBlankString(input.title) ||
    !Array.isArray(input.branchHeads) ||
    !Array.isArray(input.revisions)
  ) {
    return err(researchError("invalid_artifact"));
  }
  const id = parseResearchIdFor(input.id, "rart_");
  if (!id.ok) return id;
  const projectId = parseResearchIdFor(input.projectId, "rprj_");
  if (!projectId.ok) return projectId;
  const kind = parseArtifactKind(input.kind);
  if (!kind.ok) return kind;
  const source = parseResearchSource(input.source);
  if (!source.ok) return source;
  const version = parseEntityVersion(input.version);
  if (!version.ok) return version;
  const createdAt = validateUtcTimestamp(input.createdAt);
  if (!createdAt.ok) return createdAt;

  const revisions: ArtifactRevision[] = [];
  const revisionIds = new Set<string>();
  for (const value of input.revisions) {
    const revision = parseArtifactRevision(value);
    if (!revision.ok) return revision;
    if (
      revision.value.projectId !== projectId.value.id ||
      revision.value.artifactId !== id.value.id ||
      revisionIds.has(revision.value.id)
    ) {
      return err(researchError("invalid_artifact"));
    }
    revisionIds.add(revision.value.id);
    revisions.push(revision.value);
  }
  const branchHeads: string[] = [];
  for (const value of input.branchHeads) {
    const parsed = parseResearchIdFor(value, "rrev_");
    if (
      !parsed.ok ||
      !revisionIds.has(parsed.value.id) ||
      branchHeads.includes(parsed.value.id)
    ) {
      return err(researchError("invalid_artifact"));
    }
    branchHeads.push(parsed.value.id);
  }
  let activeRevisionId: string | undefined;
  if (input.activeRevisionId !== undefined) {
    const active = parseResearchIdFor(input.activeRevisionId, "rrev_");
    if (!active.ok || !branchHeads.includes(active.value.id)) {
      return err(researchError("invalid_artifact"));
    }
    activeRevisionId = active.value.id;
  }
  if (
    (revisions.length === 0) !== (activeRevisionId === undefined) ||
    (revisions.length === 0) !== (branchHeads.length === 0)
  ) {
    return err(researchError("invalid_artifact"));
  }
  let tombstone: ArtifactTombstone | undefined;
  if (input.tombstone !== undefined) {
    if (!isRecord(input.tombstone)) return err(researchError("invalid_artifact"));
    const tombSource = parseResearchSource(input.tombstone.source);
    if (!tombSource.ok) return tombSource;
    const at = validateUtcTimestamp(input.tombstone.tombstonedAt);
    if (!at.ok) return at;
    tombstone = { source: tombSource.value, tombstonedAt: at.value };
  }
  return ok(
    cloneFrozen({
      id: id.value.id,
      projectId: projectId.value.id,
      kind: kind.value,
      title: input.title.trim(),
      source: source.value,
      version: version.value,
      createdAt: createdAt.value,
      ...(activeRevisionId ? { activeRevisionId } : {}),
      branchHeads,
      revisions,
      ...(tombstone ? { tombstone } : {}),
    }),
  );
}

export function createResearchArtifact(
  input: {
    readonly projectId: string;
    readonly kind: ArtifactKind;
    readonly title: string;
    readonly source: ResearchSource;
  },
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<ResearchArtifact> {
  if (!isRecord(input) || !isNonBlankString(input.title)) {
    return err(researchError("invalid_artifact"));
  }
  const projectId = parseResearchIdFor(input.projectId, "rprj_");
  if (!projectId.ok) return projectId;
  const kind = parseArtifactKind(input.kind);
  if (!kind.ok) return kind;
  const source = parseResearchSource(input.source);
  if (!source.ok) return source;
  const id = parseResearchIdFor(ports.idFactory.create("rart_"), "rart_");
  if (!id.ok) return id;
  const now = readClock(ports.clock);
  if (!now.ok) return now;
  return parseResearchArtifact({
    id: id.value.id,
    projectId: projectId.value.id,
    kind: kind.value,
    title: input.title,
    source: source.value,
    version: initialEntityVersion(),
    createdAt: now.value,
    branchHeads: [],
    revisions: [],
  });
}

export function addArtifactRevision(
  current: ResearchArtifact,
  revision: ArtifactRevision,
  expectedVersion: EntityVersion,
  options: { readonly allowFork?: boolean } = {},
): ResearchResult<ResearchArtifact> {
  const artifact = parseResearchArtifact(current);
  if (!artifact.ok) return artifact;
  if (artifact.value.tombstone !== undefined) {
    return err(researchError("artifact_tombstoned"));
  }
  const candidate = parseArtifactRevision(revision);
  if (!candidate.ok) return candidate;
  if (
    candidate.value.projectId !== artifact.value.projectId ||
    candidate.value.artifactId !== artifact.value.id ||
    artifact.value.revisions.some((item) => item.id === candidate.value.id)
  ) {
    return err(researchError("invalid_revision"));
  }
  const expected = parseEntityVersion(expectedVersion);
  if (!expected.ok) return expected;
  const next = advanceEntityVersion(artifact.value.version, expected.value);
  if (!next.ok) return next;
  if (artifact.value.revisions.length === 0) {
    if (candidate.value.parentRevisionId !== undefined) {
      return err(researchError("invalid_revision_parent"));
    }
  } else {
    if (
      candidate.value.parentRevisionId === undefined ||
      !artifact.value.revisions.some(
        (item) => item.id === candidate.value.parentRevisionId,
      ) ||
      (options.allowFork !== true &&
        candidate.value.parentRevisionId !== artifact.value.activeRevisionId)
    ) {
      return err(researchError("invalid_revision_parent"));
    }
  }
  const preserveActiveParent = options.allowFork === true &&
    candidate.value.parentRevisionId === artifact.value.activeRevisionId;
  const branchHeads = artifact.value.branchHeads.filter(
    (id) => id !== candidate.value.parentRevisionId || preserveActiveParent,
  );
  branchHeads.push(candidate.value.id);
  const activeRevisionId =
    options.allowFork === true && artifact.value.activeRevisionId !== undefined
      ? artifact.value.activeRevisionId
      : candidate.value.id;
  return parseResearchArtifact({
    ...artifact.value,
    version: next.value,
    activeRevisionId,
    branchHeads,
    revisions: [...artifact.value.revisions, candidate.value],
  });
}

export function chooseArtifactBranch(
  current: ResearchArtifact,
  revisionId: string,
  expectedVersion: EntityVersion,
): ResearchResult<ResearchArtifact> {
  const artifact = parseResearchArtifact(current);
  if (!artifact.ok) return artifact;
  if (artifact.value.tombstone !== undefined) {
    return err(researchError("artifact_tombstoned"));
  }
  const revision = parseResearchIdFor(revisionId, "rrev_");
  if (!revision.ok) return revision;
  if (!artifact.value.branchHeads.includes(revision.value.id)) {
    return err(researchError("revision_not_found"));
  }
  const expected = parseEntityVersion(expectedVersion);
  if (!expected.ok) return expected;
  const next = advanceEntityVersion(artifact.value.version, expected.value);
  if (!next.ok) return next;
  return parseResearchArtifact({
    ...artifact.value,
    version: next.value,
    activeRevisionId: revision.value.id,
  });
}

export function tombstoneResearchArtifact(
  current: ResearchArtifact,
  expectedVersion: EntityVersion,
  sourceInput: ResearchSource,
  clock: Clock,
): ResearchResult<ResearchArtifact> {
  const artifact = parseResearchArtifact(current);
  if (!artifact.ok) return artifact;
  if (artifact.value.tombstone !== undefined) {
    return err(researchError("artifact_tombstoned"));
  }
  const source = parseResearchSource(sourceInput);
  if (!source.ok) return source;
  const expected = parseEntityVersion(expectedVersion);
  if (!expected.ok) return expected;
  const next = advanceEntityVersion(artifact.value.version, expected.value);
  if (!next.ok) return next;
  const at = readClock(clock);
  if (!at.ok) return at;
  return parseResearchArtifact({
    ...artifact.value,
    version: next.value,
    tombstone: { source: source.value, tombstonedAt: at.value },
  });
}

export function getArtifactRevision(
  artifactInput: ResearchArtifact,
  revisionId: string,
): ArtifactRevision | undefined {
  const artifact = parseResearchArtifact(artifactInput);
  if (!artifact.ok) return undefined;
  const id = parseResearchIdFor(revisionId, "rrev_");
  if (!id.ok) return undefined;
  const found = artifact.value.revisions.find((item) => item.id === id.value.id);
  return found === undefined ? undefined : cloneFrozen(found);
}
