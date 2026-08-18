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
import {
  ActorProvenanceSchema,
  MAX_CLAIM_EVIDENCE_REFS,
  SestinaError,
  SestinaErrorCode,
  canActAsDirectUser,
  generateId,
  isPeerProvenance,
} from "@sestina/schema";
import type {
  ClaimStore,
  ConfirmationAuthority,
  CursorInput,
  DecisionFactsRow,
  DecisionFactsSource,
  DeliverableStore,
  EvidenceStore,
  EvidencePorts,
  HistoryRead,
  HistoryWrite,
  Page,
  ReviewFactsRow,
  ReviewFactsSource,
  SituationStore,
  ToolFailureRow,
  ToolFailureSource,
} from "../src/ports.js";

// ── In-memory fakes for the evidence package unit tests ──
// They mirror the storage fences (task-in-project, project scoping, CAS,
// append-only history) closely enough to exercise the domain rules without
// any SQL.

export class World {
  readonly tasks = new Map<string, string>(); // taskId -> projectId
  taskOf(taskId: string): string | undefined {
    return this.tasks.get(taskId);
  }
  hasTask(projectId: string, taskId: string): boolean {
    return this.tasks.get(taskId) === projectId;
  }
}

export class FakeConfirmationAuthority implements ConfirmationAuthority {
  readonly trusted = new Set<string>();

  trust(
    projectId: string,
    taskId: string | undefined,
    sourceType: "tool_result" | "hook_observation",
    refId: string,
  ): void {
    this.trusted.add(this.#key(projectId, taskId, sourceType, refId));
  }

  isTrustedObservation(
    projectId: string,
    taskId: string | undefined,
    sourceType: "tool_result" | "hook_observation",
    refId: string,
  ): boolean {
    return this.trusted.has(this.#key(projectId, taskId, sourceType, refId));
  }

  #key(
    projectId: string,
    taskId: string | undefined,
    sourceType: "tool_result" | "hook_observation",
    refId: string,
  ): string {
    return `${projectId}|${taskId ?? ""}|${sourceType}|${refId}`;
  }
}

export function fakePorts(overrides: Partial<EvidencePorts> = {}): EvidencePorts {
  return {
    now: () => "2026-08-01T00:00:00.000Z",
    nowMs: () => Date.parse("2026-08-01T00:00:00.000Z"),
    newId: () => generateId(),
    redactExcerpt: (excerpt: string) => excerpt,
    ...overrides,
  };
}

function fakeCursorOffset(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const match = /^fake\.(\d+)$/.exec(cursor);
  if (!match) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "invalid fake cursor");
  }
  return Number(match[1]);
}

function toHistoryRead(row: HistoryRead): HistoryRead {
  return {
    historyId: row.historyId,
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    expectedVersion: row.expectedVersion,
    actor: structuredClone(row.actor),
    reason: row.reason,
    at: row.at,
  };
}

/** Advancing clock: each now() call moves `stepMs` forward. */
export function advancingPorts(stepMs = 1000, redact?: (excerpt: string) => string): EvidencePorts {
  let currentMs = Date.parse("2026-08-01T00:00:00.000Z");
  return {
    now: () => new Date(currentMs).toISOString(),
    nowMs: () => currentMs,
    newId: () => generateId(),
    redactExcerpt: redact ?? ((excerpt: string) => excerpt),
    tick: () => {
      currentMs += stepMs;
    },
  } as EvidencePorts;
}

export class FakeSituationStore implements SituationStore {
  readonly rows = new Map<string, SituationAssertion>();
  readonly historyRows: (HistoryRead & { rowProjectId: string; rowEntityId: string })[] = [];
  #world: World;
  #evidence: EvidenceStore;
  #authority: ConfirmationAuthority;
  #nowMs: () => number;
  constructor(
    world: World,
    evidence: EvidenceStore,
    authority: ConfirmationAuthority,
    nowMs: () => number,
  ) {
    this.#world = world;
    this.#evidence = evidence;
    this.#authority = authority;
    this.#nowMs = nowMs;
  }
  insert(assertion: SituationAssertion): void {
    if (assertion.kind === "confirmed_fact") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "confirmed facts require authority-bound confirmation",
      );
    }
    if (assertion.taskId !== undefined) {
      const project = this.#world.taskOf(assertion.taskId);
      if (project !== assertion.projectId) {
        throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
      }
    }
    this.rows.set(assertion.assertionId, structuredClone(assertion));
  }
  get(projectId: string, assertionId: string): SituationAssertion | undefined {
    const row = this.rows.get(assertionId);
    return row?.projectId === projectId ? structuredClone(row) : undefined;
  }
  listByProject(projectId: string, input: CursorInput): Page<SituationAssertion> {
    const items = [...this.rows.values()]
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => a.assertionId.localeCompare(b.assertionId))
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
    return { items };
  }
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<SituationAssertion> {
    const items = [...this.rows.values()]
      .filter((row) => row.projectId === projectId && row.taskId === taskId)
      .sort((a, b) => a.assertionId.localeCompare(b.assertionId))
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
    return { items };
  }
  listSuperseders(projectId: string, assertionId: string): SituationAssertion[] {
    return [...this.rows.values()]
      .filter((row) => row.projectId === projectId && row.supersededBy === assertionId)
      .map((row) => structuredClone(row));
  }
  confirm(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    confirmation: ConfirmationSource,
    caller: ActorProvenance,
    history: HistoryWrite,
  ): SituationAssertion {
    const current = this.rows.get(assertionId);
    if (current?.projectId !== projectId) {
      throw new SestinaError(SestinaErrorCode.assertion_not_found, "Assertion not found");
    }
    if (current.version !== expectedVersion) {
      throw new SestinaError(SestinaErrorCode.stale_state, "stale");
    }
    if (current.status !== "active" || current.kind === "confirmed_fact") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "only an active, unconfirmed assertion can be confirmed",
      );
    }
    const parsedCaller = ActorProvenanceSchema.safeParse(caller);
    if (!parsedCaller.success) {
      throw new SestinaError(SestinaErrorCode.validation_failed, "invalid caller provenance");
    }
    let legal = false;
    switch (confirmation.sourceType) {
      case "verified_evidence": {
        const evidence = this.#evidence.get(projectId, confirmation.evidenceId);
        legal =
          evidence !== undefined &&
          (current.taskId === undefined || evidence.taskId === current.taskId) &&
          evidence.status === "verified" &&
          evidence.contentHash === confirmation.contentHash &&
          (evidence.expiresAt === undefined || Date.parse(evidence.expiresAt) > this.#nowMs());
        break;
      }
      case "tool_result":
      case "hook_observation":
        legal = this.#authority.isTrustedObservation(
          projectId,
          current.taskId,
          confirmation.sourceType,
          confirmation.refId,
        );
        break;
      case "direct_user":
        legal =
          canActAsDirectUser(parsedCaller.data) &&
          JSON.stringify(parsedCaller.data) === JSON.stringify(confirmation.provenance);
        break;
      case "judge_opinion":
        break;
    }
    if (!legal) {
      throw new SestinaError(
        SestinaErrorCode.insufficient_confirmation_source,
        "confirmation source is not authoritative",
      );
    }
    const next = {
      ...current,
      kind: "confirmed_fact",
      confirmations: [...(current.confirmations ?? []), structuredClone(confirmation)],
      version: expectedVersion + 1,
    } as SituationAssertion;
    this.rows.set(assertionId, structuredClone(next));
    this.historyRows.push({
      ...history,
      fromStatus: history.fromStatus ?? current.status,
      actor: JSON.parse(history.actorJson) as unknown,
      reason: history.reason ?? null,
      at: new Date(history.atMs).toISOString(),
      rowProjectId: projectId,
      rowEntityId: assertionId,
    });
    return structuredClone(next);
  }
  transition(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    next: SituationAssertion,
    history: HistoryWrite,
  ): void {
    const current = this.rows.get(assertionId);
    if (current?.projectId !== projectId) {
      throw new SestinaError(SestinaErrorCode.assertion_not_found, "Assertion not found");
    }
    if (current.version !== expectedVersion) {
      throw new SestinaError(SestinaErrorCode.stale_state, "stale");
    }
    if (next.kind !== current.kind) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "assertion kind is immutable outside authority-bound confirmation",
      );
    }
    this.rows.set(assertionId, structuredClone(next));
    this.historyRows.push({
      ...history,
      fromStatus: history.fromStatus ?? current.status,
      actor: JSON.parse(history.actorJson) as unknown,
      reason: history.reason ?? null,
      at: new Date(history.atMs).toISOString(),
      rowProjectId: projectId,
      rowEntityId: assertionId,
    });
  }
  history(projectId: string, assertionId: string): HistoryRead[] {
    return this.historyRows
      .filter((row) => row.rowProjectId === projectId && row.rowEntityId === assertionId)
      .map(toHistoryRead);
  }
}

export class FakeEvidenceStore implements EvidenceStore {
  readonly rows = new Map<string, EvidenceItem>();
  readonly links = new Map<string, ClaimEvidenceLink>(); // key: claimId|evidenceId
  readonly historyRows: (HistoryRead & { rowProjectId: string; rowEntityId: string })[] = [];
  readonly #world: World;
  constructor(world: World) {
    this.#world = world;
  }
  #projectOf(item: EvidenceItem): string {
    const project = this.#world.taskOf(item.taskId);
    if (!project) {
      throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found");
    }
    return project;
  }
  insert(projectId: string, item: EvidenceItem): void {
    if (item.status !== "unverified") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "new evidence must start unverified",
      );
    }
    const project = this.#projectOf(item);
    if (project !== projectId) {
      throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
    }
    const duplicate = [...this.rows.values()].find(
      (row) =>
        this.#world.taskOf(row.taskId) === projectId &&
        row.taskId === item.taskId &&
        row.contentHash !== undefined &&
        row.contentHash === item.contentHash,
    );
    if (duplicate) {
      throw new SestinaError(
        SestinaErrorCode.idempotency_violation,
        "duplicate content hash for task",
      );
    }
    this.rows.set(item.evidenceId, structuredClone(item));
  }
  get(projectId: string, evidenceId: string): EvidenceItem | undefined {
    const row = this.rows.get(evidenceId);
    return row && this.#world.taskOf(row.taskId) === projectId ? structuredClone(row) : undefined;
  }
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<EvidenceItem> {
    const items = [...this.rows.values()]
      .filter((row) => row.taskId === taskId && this.#world.taskOf(row.taskId) === projectId)
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId))
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
    return { items };
  }
  listByIds(projectId: string, evidenceIds: readonly string[]): EvidenceItem[] {
    return evidenceIds
      .map((id) => this.get(projectId, id))
      .filter((row): row is EvidenceItem => row !== undefined);
  }
  findByContentHash(projectId: string, taskId: string, contentHash: string): EvidenceItem | undefined {
    return [...this.rows.values()].find(
      (row) =>
        row.taskId === taskId &&
        this.#world.taskOf(row.taskId) === projectId &&
        row.contentHash === contentHash,
    );
  }
  transition(
    projectId: string,
    evidenceId: string,
    expectedVersion: number,
    nextStatus: EvidenceStatus,
    history: HistoryWrite,
  ): void {
    const current = this.get(projectId, evidenceId);
    if (!current) {
      throw new SestinaError(SestinaErrorCode.evidence_not_found, "Evidence item not found");
    }
    if (current.version !== expectedVersion) {
      throw new SestinaError(SestinaErrorCode.stale_state, "stale");
    }
    const actor = ActorProvenanceSchema.safeParse(JSON.parse(history.actorJson) as unknown);
    if (!actor.success) {
      throw new SestinaError(SestinaErrorCode.validation_failed, "invalid history actor");
    }
    if (nextStatus === "verified" && isPeerProvenance(actor.data)) {
      throw new SestinaError(SestinaErrorCode.forbidden, "peer provenance cannot verify evidence");
    }
    this.rows.set(evidenceId, { ...current, status: nextStatus, version: expectedVersion + 1 });
    this.historyRows.push({
      ...history,
      fromStatus: history.fromStatus ?? current.status,
      actor: JSON.parse(history.actorJson) as unknown,
      reason: history.reason ?? null,
      at: new Date(history.atMs).toISOString(),
      rowProjectId: projectId,
      rowEntityId: evidenceId,
    });
  }
  linkClaimEvidence(projectId: string, link: ClaimEvidenceLink): void {
    const claim = this.#claims.get(link.claimId);
    const evidence = this.get(projectId, link.evidenceId);
    if (
      claim?.projectId !== projectId ||
      claim.taskId === null ||
      evidence?.taskId !== claim.taskId
    ) {
      throw new SestinaError(
        SestinaErrorCode.project_isolation_violation,
        "Claim and evidence item must belong to the same project",
      );
    }
    const key = `${link.claimId}|${link.evidenceId}`;
    const existing = this.links.get(key);
    if (existing) {
      const same =
        existing.relation === link.relation &&
        existing.strength === link.strength &&
        JSON.stringify(existing.provenance) === JSON.stringify(link.provenance);
      if (same) {
        return;
      }
      throw new SestinaError(
        SestinaErrorCode.idempotency_violation,
        "claim-evidence authority links are immutable",
      );
    }
    const linkCount = [...this.links.values()]
      .filter((candidate) => candidate.claimId === link.claimId)
      .length;
    if (linkCount >= MAX_CLAIM_EVIDENCE_REFS) {
      throw new SestinaError(
        SestinaErrorCode.limit_exceeded,
        "claim-evidence links exceed the schema bound",
      );
    }
    this.links.set(key, structuredClone(link));
    this.linkProjects.set(link.claimId, projectId);
  }
  #claims = new Map<string, { projectId: string; taskId: string | null }>();
  /** The link fence needs the claim registry; the test wires it in. */
  bindClaimsForFence(claims: Map<string, { projectId: string; taskId: string | null }>): void {
    this.#claims = claims;
  }
  readonly linkProjects = new Map<string, string>();
  listClaimLinks(projectId: string, claimId: string): ClaimEvidenceLink[] {
    const links = [...this.links.values()].filter(
      (link) => link.claimId === claimId && this.linkProjects.get(link.claimId) === projectId,
    );
    if (links.length > MAX_CLAIM_EVIDENCE_REFS) {
      throw new SestinaError(
        SestinaErrorCode.limit_exceeded,
        "claim-evidence links exceed the schema bound",
      );
    }
    return links;
  }
  history(projectId: string, evidenceId: string): HistoryRead[] {
    return this.historyRows
      .filter((row) => row.rowProjectId === projectId && row.rowEntityId === evidenceId)
      .map(toHistoryRead);
  }
}

export class FakeClaimStore implements ClaimStore {
  readonly rows = new Map<string, Claim>(); // key: projectId|claimId
  /** Live claim registry the evidence store's link fence reads. */
  readonly registry = new Map<string, { projectId: string; taskId: string | null }>();
  readonly historyRows: (HistoryRead & { rowProjectId: string })[] = [];
  readonly #world: World;
  constructor(world: World) {
    this.#world = world;
  }
  #key(projectId: string, claimId: string): string {
    return `${projectId}|${claimId}`;
  }
  insert(projectId: string, claim: Claim): void {
    const project = this.#world.taskOf(claim.taskId);
    if (project !== projectId) {
      throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
    }
    this.rows.set(this.#key(projectId, claim.claimId), structuredClone(claim));
    this.registry.set(claim.claimId, { projectId, taskId: claim.taskId });
  }
  get(projectId: string, claimId: string): Claim | undefined {
    const row = this.rows.get(this.#key(projectId, claimId));
    return row ? structuredClone(row) : undefined;
  }
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<Claim> {
    const all = [...this.rows.entries()]
      .filter(([, row]) => row.taskId === taskId)
      .filter(([key]) => key.startsWith(`${projectId}|`))
      .map(([, row]) => structuredClone(row))
      .sort((a, b) => a.claimId.localeCompare(b.claimId));
    const offset = fakeCursorOffset(input.cursor);
    const items = all.slice(offset, offset + input.limit);
    return {
      items,
      nextCursor: offset + items.length < all.length
        ? `fake.${offset + items.length}`
        : undefined,
    };
  }
  listByIds(projectId: string, claimIds: readonly string[]): Claim[] {
    return claimIds
      .map((id) => this.get(projectId, id))
      .filter((row): row is Claim => row !== undefined);
  }
  listOpenCritical(projectId: string, taskId: string, limit: number): Claim[] {
    return this.listByTask(projectId, taskId, { limit: 500 }).items.filter(
      (claim) =>
        claim.importance === "critical" &&
        claim.status !== "supported" &&
        claim.status !== "not_applicable",
    ).slice(0, limit);
  }
  transition(
    projectId: string,
    claimId: string,
    expectedVersion: number,
    next: Claim,
    history: HistoryWrite,
  ): void {
    const key = this.#key(projectId, claimId);
    const current = this.rows.get(key);
    if (!current) {
      throw new SestinaError(SestinaErrorCode.claim_not_found, "Claim not found");
    }
    if (current.version !== expectedVersion) {
      throw new SestinaError(SestinaErrorCode.stale_state, "stale");
    }
    this.rows.set(key, structuredClone(next));
    this.historyRows.push({
      ...history,
      fromStatus: history.fromStatus ?? current.status,
      actor: JSON.parse(history.actorJson) as unknown,
      reason: history.reason ?? null,
      at: new Date(history.atMs).toISOString(),
      rowProjectId: projectId,
      rowEntityId: claimId,
    });
  }
  history(projectId: string, claimId: string): HistoryRead[] {
    return this.historyRows
      .filter((row) => row.rowProjectId === projectId && row.rowEntityId === claimId)
      .map(toHistoryRead);
  }
}

export class FakeDeliverableStore implements DeliverableStore {
  readonly rows = new Map<string, DeliverableLedgerEntry>(); // key: projectId|taskId|deliverableId
  readonly historyRows: (HistoryRead & {
    rowProjectId: string;
    rowTaskId: string;
    rowEntityId: string;
  })[] = [];
  readonly #world: World;
  constructor(world: World) {
    this.#world = world;
  }
  #key(projectId: string, taskId: string, deliverableId: string): string {
    return `${projectId}|${taskId}|${deliverableId}`;
  }
  upsert(
    projectId: string,
    taskId: string,
    entry: DeliverableLedgerEntry,
    history: HistoryWrite,
  ): void {
    const project = this.#world.taskOf(taskId);
    if (project !== projectId) {
      throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
    }
    const key = this.#key(projectId, taskId, entry.deliverableId);
    const existing = this.rows.get(key);
    if (existing && entry.version !== existing.version + 1) {
      throw new SestinaError(SestinaErrorCode.stale_state, "stale");
    }
    this.rows.set(key, structuredClone(entry));
    this.historyRows.push({
      ...history,
      fromStatus: history.fromStatus ?? existing?.status ?? null,
      actor: JSON.parse(history.actorJson) as unknown,
      reason: history.reason ?? null,
      at: new Date(history.atMs).toISOString(),
      rowProjectId: projectId,
      rowTaskId: taskId,
      rowEntityId: entry.deliverableId,
    });
  }
  get(projectId: string, taskId: string, deliverableId: string): DeliverableLedgerEntry | undefined {
    const row = this.rows.get(this.#key(projectId, taskId, deliverableId));
    return row ? structuredClone(row) : undefined;
  }
  listByTask(projectId: string, taskId: string): DeliverableLedgerEntry[] {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${projectId}|${taskId}|`))
      .map(([, row]) => structuredClone(row))
      .sort((a, b) => a.deliverableId.localeCompare(b.deliverableId));
  }
  listPageByTask(
    projectId: string,
    taskId: string,
    input: CursorInput,
  ): Page<DeliverableLedgerEntry> {
    const all = this.listByTask(projectId, taskId);
    const offset = fakeCursorOffset(input.cursor);
    const items = all.slice(offset, offset + input.limit);
    return {
      items,
      nextCursor: offset + items.length < all.length
        ? `fake.${offset + items.length}`
        : undefined,
    };
  }
  transition(
    projectId: string,
    taskId: string,
    deliverableId: string,
    expectedVersion: number,
    next: DeliverableLedgerEntry,
    history: HistoryWrite,
  ): void {
    const key = this.#key(projectId, taskId, deliverableId);
    const current = this.rows.get(key);
    if (!current) {
      throw new SestinaError(SestinaErrorCode.deliverable_not_found, "Deliverable not found");
    }
    if (current.version !== expectedVersion) {
      throw new SestinaError(SestinaErrorCode.stale_state, "stale");
    }
    this.rows.set(key, structuredClone(next));
    this.historyRows.push({
      ...history,
      fromStatus: history.fromStatus ?? current.status,
      actor: JSON.parse(history.actorJson) as unknown,
      reason: history.reason ?? null,
      at: new Date(history.atMs).toISOString(),
      rowProjectId: projectId,
      rowTaskId: taskId,
      rowEntityId: deliverableId,
    });
  }
  history(projectId: string, taskId: string, deliverableId: string): HistoryRead[] {
    return this.historyRows
      .filter((row) =>
        row.rowProjectId === projectId &&
        row.rowTaskId === taskId &&
        row.rowEntityId === deliverableId,
      )
      .map(toHistoryRead);
  }
}

export class FakeDecisionSource implements DecisionFactsSource {
  constructor(readonly rows: DecisionFactsRow[]) {}
  listByTask(projectId: string, _taskId: string, input: CursorInput): Page<DecisionFactsRow> {
    void projectId;
    const offset = fakeCursorOffset(input.cursor);
    const items = this.rows.slice(offset, offset + input.limit);
    return {
      items,
      nextCursor: offset + items.length < this.rows.length
        ? `fake.${offset + items.length}`
        : undefined,
    };
  }
}

export class FakeReviewSource implements ReviewFactsSource {
  constructor(readonly rows: ReviewFactsRow[]) {}
  listByTask(projectId: string, _taskId: string, input: CursorInput): Page<ReviewFactsRow> {
    void projectId;
    const offset = fakeCursorOffset(input.cursor);
    const items = this.rows.slice(offset, offset + input.limit);
    return {
      items,
      nextCursor: offset + items.length < this.rows.length
        ? `fake.${offset + items.length}`
        : undefined,
    };
  }
}

export class FakeToolFailureSource implements ToolFailureSource {
  constructor(readonly rows: ToolFailureRow[]) {}
  listRecentToolFailures(
    _projectId: string,
    _taskId: string,
    sinceMs: number,
    limit: number,
  ): ToolFailureRow[] {
    return this.rows
      .filter((row) => Date.parse(row.occurredAt) >= sinceMs)
      .slice(0, limit);
  }
}
