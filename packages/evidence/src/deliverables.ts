import {
  SestinaError,
  SestinaErrorCode,
  DeliverableLedgerEntrySchema,
  type ActorProvenance,
  type DeliverableLedgerEntry,
  type DeliverableLedgerStatus,
  type DeliverableWaiver,
  type EvidenceItem,
} from "@sestina/schema";
import { assertDirectUser } from "./peer-provenance.js";
import type { DeliverableStore, EvidencePorts, EvidenceStore, HistoryWrite } from "./ports.js";

// ── Deliverable completion ledger (docs/22 Task 10, docs/09 §21) ──
// Synced from the compiled contract without resetting local progress:
// metadata changes and removals are versioned while status/evidence stay intact.
// `satisfied` requires live verified evidence; `waived` requires a direct
// user with a reason, a time and the contract version - peers, agents, hooks
// and MCP callers can never waive, and the legacy string waiver never
// satisfies completion.

export interface ContractDeliverableInput {
  deliverableId: string;
  description: string;
  /** Defaults to true only for compatibility with pre-Task-10 test callers. */
  required?: boolean;
}

function parseEntry(value: unknown): DeliverableLedgerEntry {
  const parsed = DeliverableLedgerEntrySchema.safeParse(value);
  if (!parsed.success) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "DeliverableLedgerEntry failed schema validation",
      undefined,
      { issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) },
    );
  }
  return parsed.data;
}

function historyEntry(
  ports: EvidencePorts,
  action: string,
  expectedVersion: number,
  actor: ActorProvenance,
  toStatus: string,
  reason?: string,
): HistoryWrite {
  return {
    historyId: ports.newId(),
    action,
    fromStatus: null,
    toStatus,
    expectedVersion,
    actorJson: JSON.stringify(actor),
    reason,
    atMs: ports.nowMs(),
  };
}

export class DeliverableLedgerService {
  readonly #deliverables: DeliverableStore;
  readonly #evidence: EvidenceStore;
  readonly #ports: EvidencePorts;

  constructor(deliverables: DeliverableStore, evidence: EvidenceStore, ports: EvidencePorts) {
    this.#deliverables = deliverables;
    this.#evidence = evidence;
    this.#ports = ports;
  }

  /**
   * Synchronizes current contract metadata under CAS. New ids start pending;
   * changed/removed ids get a new ledger version while local progress and
   * evidence remain intact. Removed ids become inactive instead of vanishing.
   */
  syncFromContract(
    projectId: string,
    taskId: string,
    contractDeliverables: readonly ContractDeliverableInput[],
    contractVersion: number,
    provenance: ActorProvenance,
  ): DeliverableLedgerEntry[] {
    if (!Number.isSafeInteger(contractVersion) || contractVersion < 1) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "contractVersion must be a positive safe integer",
      );
    }
    const currentEntries = this.#deliverables.listByTask(projectId, taskId);
    if (currentEntries.some((entry) => (entry.contractVersion ?? 1) > contractVersion)) {
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "an older contract version cannot overwrite the deliverable ledger",
      );
    }
    const known = new Map(currentEntries.map((entry) => [entry.deliverableId, entry]));
    const seen = new Set<string>();
    const changed: DeliverableLedgerEntry[] = [];
    for (const input of contractDeliverables) {
      if (seen.has(input.deliverableId)) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "contract deliverable ids must be unique",
        );
      }
      seen.add(input.deliverableId);
      const required = input.required ?? true;
      const current = known.get(input.deliverableId);
      if (current) {
        const unchanged =
          current.description === input.description &&
          current.required === required &&
          current.active &&
          current.contractVersion === contractVersion;
        if (!unchanged) {
          const entry = parseEntry({
            ...current,
            description: input.description,
            required,
            active: true,
            contractVersion,
            version: current.version + 1,
            updatedAt: this.#ports.now(),
          });
          this.#deliverables.upsert(
            projectId,
            taskId,
            entry,
            historyEntry(
              this.#ports,
              "contract_sync",
              current.version,
              provenance,
              current.status,
              `contract version ${contractVersion}`,
            ),
          );
          changed.push(entry);
        }
        continue;
      }
      const entry = parseEntry({
        deliverableId: input.deliverableId,
        description: input.description,
        status: "pending",
        evidenceRefs: [],
        required,
        active: true,
        contractVersion,
        version: 1,
        updatedAt: this.#ports.now(),
      });
      this.#deliverables.upsert(
        projectId,
        taskId,
        entry,
        historyEntry(this.#ports, "sync", 0, provenance, "pending"),
      );
      changed.push(entry);
    }
    for (const current of currentEntries) {
      if (!seen.has(current.deliverableId) && current.active) {
        const inactive = parseEntry({
          ...current,
          active: false,
          contractVersion,
          version: current.version + 1,
          updatedAt: this.#ports.now(),
        });
        this.#deliverables.upsert(
          projectId,
          taskId,
          inactive,
          historyEntry(
            this.#ports,
            "contract_remove",
            current.version,
            provenance,
            current.status,
            `removed by contract version ${contractVersion}`,
          ),
        );
        changed.push(inactive);
      }
    }
    return changed;
  }

  get(projectId: string, taskId: string, deliverableId: string): DeliverableLedgerEntry | undefined {
    return this.#deliverables.get(projectId, taskId, deliverableId);
  }

  listByTask(projectId: string, taskId: string): DeliverableLedgerEntry[] {
    return this.#deliverables.listByTask(projectId, taskId);
  }

  /**
   * CAS status transition. `satisfied` requires evidenceRefs that all resolve
   * to live verified evidence; `waived` requires direct-user provenance plus
   * a structured waiver (reason + time + version).
   */
  transitionStatus(
    projectId: string,
    taskId: string,
    deliverableId: string,
    expectedVersion: number,
    next: DeliverableLedgerStatus,
    provenance: ActorProvenance,
    options: { evidenceRefs?: string[]; waiverReason?: string } = {},
  ): DeliverableLedgerEntry {
    const current = this.#deliverables.get(projectId, taskId, deliverableId);
    if (!current) {
      throw new SestinaError(SestinaErrorCode.deliverable_not_found, "Deliverable not found");
    }
    if (current.version !== expectedVersion) {
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "Deliverable was modified concurrently; reload and retry",
      );
    }
    let evidenceRefs = current.evidenceRefs;
    let waiver: DeliverableWaiver | undefined =
      next === "waived" ? current.waiver : undefined;
    if (next === "satisfied") {
      evidenceRefs = options.evidenceRefs ?? current.evidenceRefs;
      if (evidenceRefs.length === 0) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "a satisfied deliverable requires evidence refs",
        );
      }
      this.#assertLiveVerifiedEvidence(projectId, taskId, evidenceRefs);
    }
    if (next === "waived") {
      assertDirectUser(provenance, "waive a deliverable");
      if (options.waiverReason === undefined || options.waiverReason.length === 0) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "a waived deliverable requires a reason",
        );
      }
      waiver = {
        reason: options.waiverReason,
        provenance,
        waivedAt: this.#ports.now(),
      };
    }
    const entry = parseEntry({
      ...current,
      status: next,
      evidenceRefs,
      waiver,
      version: expectedVersion + 1,
      updatedAt: this.#ports.now(),
    });
    this.#deliverables.transition(
      projectId,
      taskId,
      deliverableId,
      expectedVersion,
      entry,
      historyEntry(this.#ports, "transition", expectedVersion, provenance, next),
    );
    return entry;
  }

  history(projectId: string, taskId: string, deliverableId: string) {
    return this.#deliverables.history(projectId, taskId, deliverableId);
  }

  #assertLiveVerifiedEvidence(
    projectId: string,
    taskId: string,
    evidenceRefs: readonly string[],
  ): void {
    const nowMs = this.#ports.nowMs();
    for (const ref of evidenceRefs) {
      const item: EvidenceItem | undefined = this.#evidence.get(projectId, ref);
      const live =
        item?.taskId === taskId &&
        item.status === "verified" &&
        (item.expiresAt === undefined || Date.parse(item.expiresAt) > nowMs);
      if (!live) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "a satisfied deliverable requires live verified evidence for every ref",
        );
      }
    }
  }
}
