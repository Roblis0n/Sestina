import {
  SestinaError,
  SestinaErrorCode,
  EvidenceItemSchema,
  type ActorProvenance,
  type EvidenceItem,
  type EvidenceLocator,
} from "@sestina/schema";
import { isPeer, peerCeilingStatus } from "./peer-provenance.js";
import type { CursorInput, EvidencePorts, EvidenceStore, HistoryWrite, Page } from "./ports.js";

// ── Evidence Service (docs/22 Task 10, docs/09 §9) ──
// Task-in-project validation happens at the store fence; this layer adds the
// domain rules: canonical local locators, mandatory excerpt redaction, byte AND
// schema excerpt limits, project+task-scoped hash dedup, CAS transitions and
// the peer demotion (peer-recorded content stays unverified).

/** Excerpts are capped at 5000 UTF-8 bytes AND the schema's 5000 characters. */
export const EXCERPT_MAX_BYTES = 5000;
export const EXCERPT_MAX_CHARS = 5000;

const encoder = new TextEncoder();

/** Truncates to at most maxBytes UTF-8 bytes without splitting a code point. */
export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) {
    return value;
  }
  // Walk back from the cut until the lead byte of a character is found so a
  // multi-byte sequence is never split.
  let cut = maxBytes;
  while (cut > 0) {
    const byte = bytes[cut];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    cut -= 1;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, cut));
}

/**
 * Pure export/provider minimiser (no filesystem access). Local storage keeps
 * the canonical locator so same-basename files remain distinguishable; only
 * outbound packets call this helper.
 */
export function minimizeLocatorPath(value: string): string {
  const isAbsolute =
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(value);
  if (!isAbsolute) {
    return value;
  }
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? value;
}

function parseEvidence(value: unknown): EvidenceItem {
  const parsed = EvidenceItemSchema.safeParse(value);
  if (!parsed.success) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "EvidenceItem failed schema validation",
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

export interface RecordEvidenceInput {
  taskId: string;
  type: EvidenceItem["type"];
  locator: EvidenceLocator;
  excerpt?: string;
  contentHash?: string;
  expiresAt?: string;
  provenance: ActorProvenance;
}

export class EvidenceService {
  readonly #store: EvidenceStore;
  readonly #ports: EvidencePorts;

  constructor(store: EvidenceStore, ports: EvidencePorts) {
    this.#store = store;
    this.#ports = ports;
  }

  /**
   * Records evidence. The excerpt is redacted through the injected port and
   * capped at both the UTF-8 byte and the schema character limit; local
   * locators remain canonical; a duplicate content hash in
   * the same project+task is rejected with idempotency_violation. Peer-
   * recorded evidence always starts unverified (the reported ceiling).
   */
  record(projectId: string, input: RecordEvidenceInput): EvidenceItem {
    if (input.contentHash !== undefined) {
      const duplicate = this.#store.findByContentHash(projectId, input.taskId, input.contentHash);
      if (duplicate) {
        throw new SestinaError(
          SestinaErrorCode.idempotency_violation,
          "an evidence item with this content hash already exists for this task",
        );
      }
    }
    const excerpt = input.excerpt !== undefined
      ? truncateUtf8Bytes(this.#ports.redactExcerpt(input.excerpt), EXCERPT_MAX_BYTES)
          .slice(0, EXCERPT_MAX_CHARS)
      : undefined;
    const locator: EvidenceLocator = structuredClone(input.locator);
    const recordedBy: EvidenceItem["recordedBy"] =
      input.provenance.actor === "user"
        ? "user"
        : input.provenance.actor === "hook"
          ? "hook"
          : "agent";
    const item = parseEvidence({
      evidenceId: this.#ports.newId(),
      taskId: input.taskId,
      type: input.type,
      locator,
      excerpt,
      contentHash: input.contentHash,
      status: isPeer(input.provenance) ? peerCeilingStatus() : "unverified",
      provenance: JSON.stringify(input.provenance),
      recordedBy,
      observedAt: this.#ports.now(),
      expiresAt: input.expiresAt,
      version: 1,
    });
    this.#store.insert(projectId, item);
    return item;
  }

  get(projectId: string, evidenceId: string): EvidenceItem | undefined {
    return this.#store.get(projectId, evidenceId);
  }

  listByTask(projectId: string, taskId: string, input: CursorInput): Page<EvidenceItem> {
    return this.#store.listByTask(projectId, taskId, input);
  }

  findByContentHash(projectId: string, taskId: string, contentHash: string): EvidenceItem | undefined {
    return this.#store.findByContentHash(projectId, taskId, contentHash);
  }

  /**
   * Verifies evidence under CAS. Disputed, superseded and unavailable items
   * can never transition to verified - the statuses are sticky in that
   * direction.
   */
  verify(
    projectId: string,
    evidenceId: string,
    expectedVersion: number,
    provenance: ActorProvenance,
  ): EvidenceItem {
    if (isPeer(provenance)) {
      throw new SestinaError(
        SestinaErrorCode.forbidden,
        "peer provenance cannot verify evidence",
      );
    }
    const current = this.#require(projectId, evidenceId);
    this.#assertVersion(current, expectedVersion);
    if (current.status === "disputed" || current.status === "superseded" || current.status === "unavailable") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "disputed, superseded or unavailable evidence can never be verified",
      );
    }
    this.#store.transition(
      projectId,
      evidenceId,
      expectedVersion,
      "verified",
      historyEntry(this.#ports, "verify", expectedVersion, provenance, "verified"),
    );
    return { ...current, status: "verified", version: expectedVersion + 1 };
  }

  dispute(
    projectId: string,
    evidenceId: string,
    expectedVersion: number,
    provenance: ActorProvenance,
    reason: string,
  ): void {
    const current = this.#require(projectId, evidenceId);
    this.#assertVersion(current, expectedVersion);
    if (current.status === "superseded") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "superseded evidence cannot be disputed",
      );
    }
    this.#store.transition(
      projectId,
      evidenceId,
      expectedVersion,
      "disputed",
      historyEntry(this.#ports, "dispute", expectedVersion, provenance, "disputed", reason),
    );
  }

  /** Marks evidence superseded (its ledger history row records the reason). */
  supersede(
    projectId: string,
    evidenceId: string,
    expectedVersion: number,
    provenance: ActorProvenance,
    reason: string,
  ): void {
    const current = this.#require(projectId, evidenceId);
    this.#assertVersion(current, expectedVersion);
    this.#store.transition(
      projectId,
      evidenceId,
      expectedVersion,
      "superseded",
      historyEntry(this.#ports, "supersede", expectedVersion, provenance, "superseded", reason),
    );
  }

  history(projectId: string, evidenceId: string) {
    return this.#store.history(projectId, evidenceId);
  }

  #require(projectId: string, evidenceId: string): EvidenceItem {
    const current = this.#store.get(projectId, evidenceId);
    if (!current) {
      throw new SestinaError(SestinaErrorCode.evidence_not_found, "Evidence item not found");
    }
    return current;
  }

  #assertVersion(evidence: EvidenceItem, expectedVersion: number): void {
    if (evidence.version !== expectedVersion) {
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "Evidence item was modified concurrently; reload and retry",
      );
    }
  }
}
