import type { ResearchRepositories, ResearchUnitOfWork } from "@sestina/research";
import type { StorageDatabase } from "@sestina/storage";
import { createResearchRepositories } from "./repositories/sqlite-repositories.js";
import { createResearchUnitOfWork } from "./transactions/research-unit-of-work.js";

export type ResearchStore = ResearchRepositories & {
  readonly unitOfWork: ResearchUnitOfWork;
};

export function createResearchStore(db: StorageDatabase): ResearchStore {
  const repositories = createResearchRepositories(db);
  return Object.freeze({
    ...repositories,
    unitOfWork: createResearchUnitOfWork(db),
  });
}

export { createResearchRepositories } from "./repositories/sqlite-repositories.js";
export { mapResearchStorageError } from "./repositories/base.js";
export { createResearchUnitOfWork } from "./transactions/research-unit-of-work.js";
export { createSqliteReviewRunRepository } from "./repositories/sqlite-review-run-repository.js";
export { createArgumentGraphRepositories } from "./repositories/sqlite-argument-repositories.js";
export { backfillKernelProject, validateKernelDatabase, kernelBriefDocument, derivedKernelId, type KernelMigrationProvenance } from "./kernel/migration.js";
export { readKernelSnapshot, readKernelHead, readCanonicalState, projectKernelContext, validateKernelChain, type KernelSnapshot, type KernelProjectionSelection } from "./kernel/state.js";
export { createKernelRepositories } from "./kernel/repositories.js";
export { recoverKernelWorkflows, rebuildKernelProjection, readKernelProjection, readKernelLegacyRecord, type KernelProjectionKind } from "./kernel/workflow-recovery.js";
export { readKernelBriefMetadata,writeKernelBriefMetadata } from "./kernel/brief-metadata.js";
