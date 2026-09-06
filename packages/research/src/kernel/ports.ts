import type { ResearchActor } from "../authority/actor.js";
import type { ResearchRepositories } from "../ports/repositories.js";
import type {
  KernelAttempt,
  KernelCanonicalChange,
  KernelCorrection,
  KernelEvent,
  KernelHead,
  KernelManifest,
  KernelObjectRef,
  KernelReceipt,
  KernelResult,
  KernelReview,
} from "./records.js";

export interface KernelPageRequest {
  readonly limit: number;
  readonly cursor?: string;
}
export interface KernelPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}
export interface KernelReader<T> {
  readonly getById: (projectId: string, id: string) => T | undefined;
  listByProject(projectId: string, page: KernelPageRequest): KernelPage<T>;
}
export interface KernelRepository<T> extends KernelReader<T> {
  create(input: T): T;
  compareAndSwap(input: T, expectedVersion: number): T;
}
export interface KernelRepositories {
  readonly reviews: KernelRepository<KernelReview>;
  readonly attempts: KernelRepository<KernelAttempt>;
  readonly manifests: KernelRepository<KernelManifest>;
  readonly corrections: Pick<
    KernelRepository<KernelCorrection>,
    "create" | "getById" | "listByProject"
  >;
  readonly receipts: KernelReader<KernelReceipt>;
  readonly events: KernelReader<KernelEvent>;
  readonly heads: { get(projectId: string): KernelHead };
}
export interface KernelCanonicalCommand {
  readonly projectId: string;
  readonly authorityCommandId: string;
  readonly reviewId: string | null;
  readonly expectedReviewVersion: number | null;
  readonly expectedProjectStateRevision: number;
  readonly effectId: string;
  readonly effectKind: KernelCanonicalChange;
  readonly previewHash: string;
  readonly objectVersions: readonly KernelObjectRef[];
  readonly actor: ResearchActor;
  readonly authorityCapability: unknown;
  readonly publicReason: string;
  readonly receiptId: string;
  readonly eventId: string;
  readonly createdAt: string;
  readonly compensatesReceiptId?: string;
}
export type KernelWritePoint =
  | "object"
  | "review_terminal"
  | "revision_event"
  | "revision_head"
  | "receipt"
  | "command_identity"
  | "projection_outbox"
  | "before_commit"
  | "after_commit";
export interface KernelUnitOfWorkOptions {
  /** Supplied by the Kernel's live local session gate. Defaults to deny. */
  readonly authorize?: (command: KernelCanonicalCommand) => boolean;
  /** Separate live gate for Memory/privacy/Episode commands without a Review. */
  readonly authorizeGovernance?: (command: KernelCanonicalCommand) => boolean;
  /** Synchronous fault seam; never a Provider/transport callback. */
  readonly faultInjection?: (point: KernelWritePoint) => void;
}
export interface KernelUnitOfWork {
  readonly repositories: KernelRepositories;
  workflow<T>(work: (repositories: KernelRepositories) => T): KernelResult<T>;
  commitCanonical(
    command: KernelCanonicalCommand,
    work: (repositories: ResearchRepositories) => void,
  ): KernelResult<KernelReceipt>;
  lookupCommand(
    projectId: string,
    authorityCommandId: string,
  ): KernelResult<KernelReceipt | undefined>;
}
