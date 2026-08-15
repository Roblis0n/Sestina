import { createHash } from "node:crypto";
import {
  SestinaError,
  SestinaErrorCode,
  canActAsDirectUser,
  generateId,
  type ActorProvenance,
  type Boundary,
  type Correction,
  type CorrectionFailureClass,
  type CorrectionPromotion,
  type CorrectionScope,
  type CorrectionSeverity,
} from "@sestina/schema";

// ── Correction recording (docs/33 §7, docs/22 Task 9) ──
//
// This module is self-contained: it produces domain results only (a
// recorded Correction, or a CorrectionPromotion plus the task-scoped record
// it was promoted from). Append-only history semantics live in the storage
// layer; the caller wires a task-level confirmation into a contract version
// separately. Time and ids are explicit inputs — nothing here reads a clock.

export interface RecordCorrectionInput {
  projectId: string;
  /** Required when the effective scope is "task" (the default). */
  taskId?: string;
  /** Default "task". */
  scope?: CorrectionScope;
  /** 用户原意摘要 — the user's intended meaning in one line. */
  summary: string;
  normalizedInstruction: string;
  originalEventRef: string;
  failureClass: CorrectionFailureClass;
  severity: CorrectionSeverity;
  actor: ActorProvenance;
  expiresWhen?: string;
  confirmedAt?: string;
  createdAt: string;
  /** Default generateId(). */
  correctionId?: string;
  /** Default 0. */
  recurrenceCount?: number;
}

export type RecordCorrectionResult =
  | { kind: "recorded"; correction: Correction }
  | {
      kind: "promotion_required";
      proposal: CorrectionPromotion;
      taskLevelCorrection: Correction;
    };

/**
 * Canonical instruction form: Unicode NFC composition, trimmed, with any
 * internal whitespace run (spaces, tabs, newlines, full-width spaces)
 * collapsed to a single space. Idempotent, so re-normalising an already
 * normalised instruction is a no-op.
 */
export function normalizeInstruction(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

// ── FNV-1a 64-bit (standard offset basis and prime) ──
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

/**
 * Deterministic recurrence fingerprint: FNV-1a 64-bit over the UTF-8 bytes
 * of `projectId | (taskId ?? "") | scope | failureClass | normalizedInstruction`
 * ("|" as delimiter; an absent taskId contributes an empty segment). Output
 * is lowercase hex at a fixed width of 16 digits, so identical inputs always
 * produce the identical fingerprint and any change to project, task, scope,
 * failure class or instruction produces a different one.
 */
export function fingerprintRecurrence(
  projectId: string,
  taskId: string | undefined,
  scope: CorrectionScope,
  failureClass: CorrectionFailureClass,
  normalizedInstruction: string,
): string {
  const joined = `${projectId}|${taskId ?? ""}|${scope}|${failureClass}|${normalizedInstruction}`;
  let hash = FNV64_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(joined)) {
    hash = ((hash ^ BigInt(byte)) * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Records a correction. `confirmed` is derived from the actor provenance via
 * canActAsDirectUser — the input's directUser flag is never trusted by
 * itself, so peer/MCP/host actors (or any non-direct-user actor) can only
 * produce unconfirmed candidates. session/task scope returns the recorded
 * correction; project/user scope NEVER widens silently — it returns the
 * task-scoped record plus a promotion proposal that always requires
 * separate user confirmation.
 */
export function recordCorrection(input: RecordCorrectionInput): RecordCorrectionResult {
  const scope = input.scope ?? "task";
  switch (scope) {
    case "task":
    case "session": {
      if (scope === "task" && input.taskId === undefined) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "Task scope requires a taskId",
        );
      }
      return { kind: "recorded", correction: buildCorrection(input, scope) };
    }
    case "project":
    case "user": {
      const taskLevelCorrection = buildCorrection(input, "task");
      return {
        kind: "promotion_required",
        proposal: buildPromotion(input, scope, taskLevelCorrection),
        taskLevelCorrection,
      };
    }
    default:
      // Unreachable for typed callers; a runtime-invalid scope must not
      // fall through into either branch.
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        `Invalid correction scope: ${String(scope)}`,
      );
  }
}

function buildCorrection(input: RecordCorrectionInput, scope: CorrectionScope): Correction {
  const confirmed = canActAsDirectUser(input.actor);
  const normalizedInstruction = normalizeInstruction(input.normalizedInstruction);
  return {
    schemaVersion: "1.0.0",
    correctionId: input.correctionId ?? generateId(),
    projectId: input.projectId as Correction["projectId"],
    ...(input.taskId !== undefined ? { taskId: input.taskId as Correction["taskId"] } : {}),
    scope,
    summary: input.summary,
    normalizedInstruction,
    originalEventRef: input.originalEventRef,
    failureClass: input.failureClass,
    severity: input.severity,
    actor: input.actor,
    confirmed,
    recurrenceCount: input.recurrenceCount ?? 0,
    recurrenceFingerprint: fingerprintRecurrence(
      input.projectId,
      input.taskId,
      scope,
      input.failureClass,
      normalizedInstruction,
    ),
    ...(input.expiresWhen !== undefined ? { expiresWhen: input.expiresWhen } : {}),
    ...(confirmed ? { confirmedAt: input.confirmedAt ?? input.createdAt } : {}),
    createdAt: input.createdAt,
  };
}

function buildPromotion(
  input: RecordCorrectionInput,
  toScope: "project" | "user",
  taskLevelCorrection: Correction,
): CorrectionPromotion {
  const directUser = canActAsDirectUser(input.actor);
  const proposedBoundary: Boundary = {
    boundaryId: generateId(),
    kind: "process",
    severity: "soft",
    statement: input.summary,
    source: {
      type: directUser ? "user_directive" : "correction",
      confidence: 1,
    },
    owner: directUser ? "user" : "inferred",
    overridable: true,
    appliesTo: {},
    confidence: 1,
    status: "active",
    validFrom: input.createdAt,
  };
  return {
    promotionId: input.correctionId ?? generateId(),
    fromCorrectionId: taskLevelCorrection.correctionId,
    fromScope: "task",
    toScope,
    proposedBoundary,
    requiresConfirmation: true,
    previewHash: sha256Hex(canonicalize(proposedBoundary)),
    createdAt: input.createdAt,
  };
}

/**
 * Canonical value for preview hashing: every object level is rebuilt with
 * keys in sorted order, so two structurally equal boundaries serialise to
 * the identical JSON string regardless of key insertion order. Arrays are
 * mapped element-wise and primitives pass through. This key ordering is the
 * documented canonical form behind previewHash.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}
