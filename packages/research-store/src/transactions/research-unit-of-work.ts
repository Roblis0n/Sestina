import type {
  ResearchRepositories,
  ResearchResult,
  ResearchUnitOfWork,
} from "@sestina/research";
import type { StorageDatabase } from "@sestina/storage";
import { writeResult } from "../repositories/base.js";
import { createResearchRepositories } from "../repositories/sqlite-repositories.js";

export function createResearchUnitOfWork(db: StorageDatabase): ResearchUnitOfWork {
  const repositories = createResearchRepositories(db);
  return Object.freeze({
    repositories,
    commit<T>(work: (value: ResearchRepositories) => ResearchResult<T>): ResearchResult<T> {
      return writeResult(db, () => work(repositories));
    },
  });
}
