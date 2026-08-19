import type { ResearchSource } from "../authority/source.js";
import { parseResearchSource, validateUtcTimestamp } from "../authority/source.js";
import type { Clock } from "../clock.js";
import {
  cloneFrozen,
  isNonBlankString,
  isRecord,
  parseSafeRelativePath,
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

export interface ResearchProject {
  readonly id: string;
  readonly title: string;
  readonly rootPath: string;
  readonly source: ResearchSource;
  readonly version: EntityVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateResearchProjectInput {
  readonly title: string;
  readonly rootPath: string;
  readonly source: ResearchSource;
}

export interface UpdateResearchProjectInput {
  readonly title?: string;
  readonly rootPath?: string;
  readonly expectedVersion: EntityVersion;
}

export function parseResearchProject(
  input: unknown,
): ResearchResult<ResearchProject> {
  if (!isRecord(input) || !isNonBlankString(input.title)) {
    return err(researchError("invalid_project"));
  }
  const id = parseResearchIdFor(input.id, "rprj_");
  if (!id.ok) return id;
  const root = parseSafeRelativePath(input.rootPath, { allowRoot: true });
  if (!root.ok) return root;
  const source = parseResearchSource(input.source);
  if (!source.ok) return source;
  const version = parseEntityVersion(input.version);
  if (!version.ok) return version;
  const createdAt = validateUtcTimestamp(input.createdAt);
  if (!createdAt.ok) return createdAt;
  const updatedAt = validateUtcTimestamp(input.updatedAt);
  if (!updatedAt.ok) return updatedAt;
  return ok(
    cloneFrozen({
      id: id.value.id,
      title: input.title.trim(),
      rootPath: root.value,
      source: source.value,
      version: version.value,
      createdAt: createdAt.value,
      updatedAt: updatedAt.value,
    }),
  );
}

export function createResearchProject(
  input: CreateResearchProjectInput,
  ports: { readonly clock: Clock; readonly idFactory: IdFactory },
): ResearchResult<ResearchProject> {
  if (!isRecord(input) || !isNonBlankString(input.title)) {
    return err(researchError("invalid_project"));
  }
  const root = parseSafeRelativePath(input.rootPath, { allowRoot: true });
  if (!root.ok) return root;
  const source = parseResearchSource(input.source);
  if (!source.ok) return source;
  const id = parseResearchIdFor(ports.idFactory.create("rprj_"), "rprj_");
  if (!id.ok) return id;
  const now = readClock(ports.clock);
  if (!now.ok) return now;
  return parseResearchProject({
    id: id.value.id,
    title: input.title,
    rootPath: root.value,
    source: source.value,
    version: initialEntityVersion(),
    createdAt: now.value,
    updatedAt: now.value,
  });
}

export function updateResearchProject(
  current: ResearchProject,
  input: UpdateResearchProjectInput,
  ports: { readonly clock: Clock },
): ResearchResult<ResearchProject> {
  const parsed = parseResearchProject(current);
  if (!parsed.ok) return parsed;
  if (!isRecord(input)) return err(researchError("invalid_project"));
  const expected = parseEntityVersion(input.expectedVersion);
  if (!expected.ok) return expected;
  const nextVersion = advanceEntityVersion(
    parsed.value.version,
    expected.value,
  );
  if (!nextVersion.ok) return nextVersion;
  const title = input.title ?? parsed.value.title;
  if (!isNonBlankString(title)) return err(researchError("invalid_project"));
  const root =
    input.rootPath === undefined
      ? ok(parsed.value.rootPath)
      : parseSafeRelativePath(input.rootPath, { allowRoot: true });
  if (!root.ok) return root;
  const now = readClock(ports.clock);
  if (!now.ok) return now;
  return parseResearchProject({
    ...parsed.value,
    title,
    rootPath: root.value,
    version: nextVersion.value,
    updatedAt: now.value,
  });
}
