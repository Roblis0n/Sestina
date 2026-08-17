import type {
  ActorProvenance,
  Claim,
  ClaimEvidenceLink,
  ConfirmationSource,
  DeliverableLedgerEntry,
  EvidenceItem,
  EvidenceStatus,
  SituationAssertion,
} from "@sestina/schema";

// ── Host-neutral ports (docs/22 Task 10) ──
// The evidence package is a pure domain layer: it depends only on
// @sestina/schema and these narrow structural ports. Time, ids, redaction
// and persistence are injected; there is no SQL here, no process.env, no
// filesystem access. The storage repositories satisfy the store ports
// structurally; the composition root (desktop app, Task 12+) binds them.

export interface CursorInput {
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

/** Composite task fence used before an authoritative facts projection. */
export interface TaskScopeSource {
  hasTask(projectId: string, taskId: string): boolean;
}

export type TrustedObservationType = "tool_result" | "hook_observation";

/**
 * Resolves trusted observations from host-owned persisted state. Callers only
 * supply an opaque reference; a `trusted` payload bit is never authoritative.
 */
export interface ConfirmationAuthority {
  isTrustedObservation(
    projectId: string,
    taskId: string | undefined,
    sourceType: TrustedObservationType,
    refId: string,
  ): boolean;
}

/** One append-only history row (mirrors the storage ledger history shape). */
export interface HistoryWrite {
  historyId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  expectedVersion: number;
  actorJson: string;
  reason?: string;
  atMs: number;
}

export interface HistoryRead {
  historyId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  expectedVersion: number;
  actor: unknown;
  reason: string | null;
  at: string;
}

export interface SituationStore {
  insert(assertion: SituationAssertion): void;
  get(projectId: string, assertionId: string): SituationAssertion | undefined;
  listByProject(projectId: string, input: CursorInput): Page<SituationAssertion>;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<SituationAssertion>;
  listSuperseders(projectId: string, assertionId: string): SituationAssertion[];
  /**
   * The sole persistence path that may promote an assertion to
   * confirmed_fact. Implementations revalidate the authority source while
   * holding the same transaction as the CAS update.
   */
  confirm(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    confirmation: ConfirmationSource,
    caller: ActorProvenance,
    history: HistoryWrite,
  ): SituationAssertion;
  transition(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    next: SituationAssertion,
    history: HistoryWrite,
  ): void;
  history(projectId: string, assertionId: string): HistoryRead[];
}

export interface EvidenceStore {
  /** Inserts only when item.taskId belongs to the explicit project fence. */
  insert(projectId: string, item: EvidenceItem): void;
  get(projectId: string, evidenceId: string): EvidenceItem | undefined;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<EvidenceItem>;
  listByIds(projectId: string, evidenceIds: readonly string[]): EvidenceItem[];
  findByContentHash(
    projectId: string,
    taskId: string,
    contentHash: string,
  ): EvidenceItem | undefined;
  transition(
    projectId: string,
    evidenceId: string,
    expectedVersion: number,
    nextStatus: EvidenceStatus,
    history: HistoryWrite,
  ): void;
  linkClaimEvidence(projectId: string, link: ClaimEvidenceLink): void;
  listClaimLinks(projectId: string, claimId: string): ClaimEvidenceLink[];
  history(projectId: string, evidenceId: string): HistoryRead[];
}

export interface ClaimStore {
  insert(projectId: string, claim: Claim): void;
  get(projectId: string, claimId: string): Claim | undefined;
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<Claim>;
  listByIds(projectId: string, claimIds: readonly string[]): Claim[];
  listOpenCritical(projectId: string, taskId: string, limit: number): Claim[];
  transition(
    projectId: string,
    claimId: string,
    expectedVersion: number,
    next: Claim,
    history: HistoryWrite,
  ): void;
  history(projectId: string, claimId: string): HistoryRead[];
}

export interface DeliverableStore {
  upsert(
    projectId: string,
    taskId: string,
    entry: DeliverableLedgerEntry,
    history: HistoryWrite,
  ): void;
  get(projectId: string, taskId: string, deliverableId: string): DeliverableLedgerEntry | undefined;
  listByTask(projectId: string, taskId: string): DeliverableLedgerEntry[];
  /** Keyset page used by authoritative completion loading. */
  listPageByTask(
    projectId: string,
    taskId: string,
    input: CursorInput,
  ): Page<DeliverableLedgerEntry>;
  transition(
    projectId: string,
    taskId: string,
    deliverableId: string,
    expectedVersion: number,
    next: DeliverableLedgerEntry,
    history: HistoryWrite,
  ): void;
  history(projectId: string, taskId: string, deliverableId: string): HistoryRead[];
}

/** Structural subset of the decision rows completion facts needs. */
export interface DecisionFactsRow {
  decisionId: string;
  reasonCode: string;
  reason: string;
  userDecisionNeeded: boolean;
  createdAt: string;
}

export interface DecisionFactsSource {
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<DecisionFactsRow>;
}

/** Structural subset of the review rows completion facts needs. */
export interface ReviewFactsRow {
  reviewId: string;
  decisionRef?: string;
  title: string;
  status: string;
  openedAt: string;
}

export interface ReviewFactsSource {
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<ReviewFactsRow>;
}

/** Tool-failure rows for completion loading (served by idx_events_tool_failure). */
export interface ToolFailureRow {
  eventId: string;
  toolName: string;
  error: string;
  occurredAt: string;
}

export interface ToolFailureSource {
  listRecentToolFailures(
    projectId: string,
    taskId: string,
    sinceMs: number,
    limit: number,
  ): ToolFailureRow[];
}

/** Injected environment: time, ids and excerpt redaction (never fs/env). */
export interface EvidencePorts {
  /** Current time as an ISO instant. */
  now(): string;
  /** Current time in epoch milliseconds. */
  nowMs(): number;
  /** Fresh opaque id (ULID-shaped). */
  newId(): string;
  /** Host-supplied redaction applied to every excerpt before storage. */
  redactExcerpt(excerpt: string): string;
}
