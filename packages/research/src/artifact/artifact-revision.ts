import type { ResearchSource } from "../authority/source.js";
import { parseResearchSource, validateUtcTimestamp } from "../authority/source.js";
import type { Clock } from "../clock.js";
import { cloneFrozen, isRecord, readClock } from "../domain-validation.js";
import { researchError } from "../errors.js";
import { parseResearchIdFor } from "../identity/research-id.js";
import type { IdFactory } from "../index.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";
import {
  contentReferenceForInline,
  parseContentReference,
  type ContentReference,
  type ResearchMediaType,
} from "./content-reference.js";

export interface ArtifactRevision {
  readonly id: string;
  readonly projectId: string;
  readonly artifactId: string;
  readonly parentRevisionId?: string;
  readonly content: ContentReference;
  readonly inlineContent?: string;
  readonly source: ResearchSource;
  readonly createdAt: string;
}

export type CreateArtifactRevisionInput = {
  readonly projectId: string;
  readonly artifactId: string;
  readonly parentRevisionId?: string;
  readonly source: ResearchSource;
} &
  (
    | {
        readonly content: string;
        readonly mediaType: ResearchMediaType;
        readonly contentReference?: never;
      }
    | {
        readonly contentReference: ContentReference;
        readonly content?: never;
        readonly mediaType?: never;
      }
  );

export function parseArtifactRevision(
  input: unknown,
): ResearchResult<ArtifactRevision> {
  if (!isRecord(input)) return err(researchError("invalid_revision"));
  const id = parseResearchIdFor(input.id, "rrev_");
  if (!id.ok) return id;
  const projectId = parseResearchIdFor(input.projectId, "rprj_");
  if (!projectId.ok) return projectId;
  const artifactId = parseResearchIdFor(input.artifactId, "rart_");
  if (!artifactId.ok) return artifactId;
  let parentRevisionId: string | undefined;
  if (input.parentRevisionId !== undefined) {
    const parent = parseResearchIdFor(input.parentRevisionId, "rrev_");
    if (!parent.ok) return parent;
    parentRevisionId = parent.value.id;
  }
  const content = parseContentReference(input.content);
  if (!content.ok) return content;
  if (content.value.storage === "inline") {
    if (typeof input.inlineContent !== "string") {
      return err(researchError("invalid_revision"));
    }
    const recomputed = contentReferenceForInline(
      input.inlineContent,
      content.value.mediaType,
    );
    if (
      !recomputed.ok ||
      recomputed.value.reference.contentHash !== content.value.contentHash ||
      recomputed.value.reference.byteLength !== content.value.byteLength
    ) {
      return err(researchError("invalid_content_reference"));
    }
  } else if (input.inlineContent !== undefined) {
    return err(researchError("invalid_revision"));
  }
  const source = parseResearchSource(input.source);
  if (!source.ok) return source;
  const createdAt = validateUtcTimestamp(input.createdAt);
  if (!createdAt.ok) return createdAt;
  return ok(
    cloneFrozen({
      id: id.value.id,
      projectId: projectId.value.id,
      artifactId: artifactId.value.id,
      ...(parentRevisionId ? { parentRevisionId } : {}),
      content: content.value,
      ...(typeof input.inlineContent === "string"
        ? { inlineContent: input.inlineContent }
        : {}),
      source: source.value,
      createdAt: createdAt.value,
    }),
  );
}

export function createArtifactRevision(
  input: CreateArtifactRevisionInput,
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<ArtifactRevision> {
  if (!isRecord(input)) return err(researchError("invalid_revision"));
  const projectId = parseResearchIdFor(input.projectId, "rprj_");
  if (!projectId.ok) return projectId;
  const artifactId = parseResearchIdFor(input.artifactId, "rart_");
  if (!artifactId.ok) return artifactId;
  let parentRevisionId: string | undefined;
  if (input.parentRevisionId !== undefined) {
    const parent = parseResearchIdFor(input.parentRevisionId, "rrev_");
    if (!parent.ok) return parent;
    parentRevisionId = parent.value.id;
  }
  const source = parseResearchSource(input.source);
  if (!source.ok) return source;
  const id = parseResearchIdFor(ports.idFactory.create("rrev_"), "rrev_");
  if (!id.ok) return id;
  const now = readClock(ports.clock);
  if (!now.ok) return now;

  let content: ContentReference;
  let inlineContent: string | undefined;
  if (input.contentReference !== undefined) {
    const parsed = parseContentReference(input.contentReference);
    if (!parsed.ok) return parsed;
    content = parsed.value;
  } else {
    const inline = contentReferenceForInline(input.content, input.mediaType);
    if (!inline.ok) return inline;
    content = inline.value.reference;
    inlineContent = inline.value.content;
  }
  return parseArtifactRevision({
    id: id.value.id,
    projectId: projectId.value.id,
    artifactId: artifactId.value.id,
    ...(parentRevisionId ? { parentRevisionId } : {}),
    content,
    ...(inlineContent !== undefined ? { inlineContent } : {}),
    source: source.value,
    createdAt: now.value,
  });
}

export function rebuildArtifactRevisionChain(
  revisions: readonly ArtifactRevision[],
  headRevisionId: string,
): ResearchResult<readonly ArtifactRevision[]> {
  const head = parseResearchIdFor(headRevisionId, "rrev_");
  if (!head.ok) return head;
  if (!Array.isArray(revisions)) return err(researchError("invalid_revision"));
  const byId = new Map<string, ArtifactRevision>();
  for (const value of revisions) {
    const parsed = parseArtifactRevision(value);
    if (!parsed.ok) return parsed;
    if (byId.has(parsed.value.id)) return err(researchError("invalid_revision"));
    byId.set(parsed.value.id, parsed.value);
  }
  const result: ArtifactRevision[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = head.value.id;
  while (cursor !== undefined) {
    if (seen.has(cursor)) return err(researchError("invalid_revision_parent"));
    seen.add(cursor);
    const revision = byId.get(cursor);
    if (revision === undefined) return err(researchError("revision_not_found"));
    result.push(revision);
    cursor = revision.parentRevisionId;
  }
  result.reverse();
  const projectId = result[0]?.projectId;
  const artifactId = result[0]?.artifactId;
  if (
    result.some(
      (item) => item.projectId !== projectId || item.artifactId !== artifactId,
    )
  ) {
    return err(researchError("invalid_revision"));
  }
  return ok(cloneFrozen(result));
}
