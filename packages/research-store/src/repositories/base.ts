import {
  parseEntityVersion,
  researchError,
  type EntityVersion,
  type ResearchError,
  type ResearchResult,
} from "@sestina/research";
import { withTransaction, type StorageDatabase } from "@sestina/storage";

export class DomainFailure extends Error {
  readonly researchError: ResearchError;

  constructor(error: ResearchError) {
    super(error.message);
    this.name = "DomainFailure";
    this.researchError = error;
  }
}

export function mapResearchStorageError(error: unknown): ResearchError {
  if (error instanceof DomainFailure) return error.researchError;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "database_readonly") return researchError("research_storage_readonly");
  if (code === "storage_busy" || code === "database_locked") {
    return researchError("research_storage_unavailable");
  }
  return researchError("research_storage_unavailable");
}

export function readResult<T>(work: () => ResearchResult<T>): ResearchResult<T> {
  try {
    return work();
  } catch (error) {
    return { ok: false, error: mapResearchStorageError(error) };
  }
}

export function writeResult<T>(
  db: StorageDatabase,
  work: () => ResearchResult<T>,
): ResearchResult<T> {
  try {
    return withTransaction(db, () => {
      const result = work();
      if (!result.ok) throw new DomainFailure(result.error);
      return result;
    });
  } catch (error) {
    return { ok: false, error: mapResearchStorageError(error) };
  }
}

export function requireExpectedNext(
  currentVersion: EntityVersion,
  expectedVersion: EntityVersion,
  nextVersion: EntityVersion,
): ResearchResult<void> {
  const expected = parseEntityVersion(expectedVersion);
  if (!expected.ok) return expected;
  if (currentVersion !== expected.value || nextVersion !== expected.value + 1) {
    return { ok: false, error: researchError("version_conflict") };
  }
  return { ok: true, value: undefined };
}

export function notFound<T>(): ResearchResult<T> {
  return { ok: false, error: researchError("research_record_not_found") };
}

export function immutablePage<T>(
  items: readonly T[],
  nextCursor: string | undefined,
): { readonly items: readonly T[]; readonly nextCursor?: string } {
  return Object.freeze({
    items: Object.freeze([...items]),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
}
