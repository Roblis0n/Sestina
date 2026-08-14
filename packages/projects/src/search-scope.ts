import {
  search,
  type SearchKind,
  type SearchRow,
  type StorageDatabase,
} from "@sestina/storage";

// ── Project-scoped search (docs/22 Task 8, docs/31 §8) ──
// Every body query is pinned to one project. The storage search already
// joins every FTS hit back to its owning project, so rows from other
// projects can never surface; this wrapper keeps that contract as the
// only search entry point the project layer exposes.

export interface ProjectSearchQuery {
  projectId: string;
  text: string;
  kinds?: readonly SearchKind[];
  limit: number;
}

export function searchInProject(db: StorageDatabase, query: ProjectSearchQuery): SearchRow[] {
  return search(db, {
    projectId: query.projectId,
    text: query.text,
    kinds: query.kinds,
    limit: query.limit,
  });
}
