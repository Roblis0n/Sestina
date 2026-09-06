import type {
  ResearchRepositories,
  ResearchResult,
  ResearchUnitOfWork,
  KernelUnitOfWorkOptions,
} from "@sestina/research";
import { hasKernelSchema, type StorageDatabase } from "@sestina/storage";
import { createKernelUnitOfWork } from "../kernel/unit-of-work.js";
import { writeResult } from "../repositories/base.js";
import { createResearchRepositories } from "../repositories/sqlite-repositories.js";

export function createResearchUnitOfWork(db: StorageDatabase, options: KernelUnitOfWorkOptions = {}): ResearchUnitOfWork {
  const repositories = createResearchRepositories(db);
  return Object.freeze({
    repositories,
    ...(hasKernelSchema(db) ? { kernel: createKernelUnitOfWork(db, repositories, options) } : {}),
    commit<T>(work: (value: ResearchRepositories) => ResearchResult<T>): ResearchResult<T> {
      return writeResult(db, () => work(repositories));
    },
  });
}
